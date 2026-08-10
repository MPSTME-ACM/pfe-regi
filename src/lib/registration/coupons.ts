import { db } from '@/lib/db';
import { coupons, couponRedemptions, referrers } from '@/lib/db/schema';
import { and, eq, gt, inArray, or, sql } from 'drizzle-orm';
import { normaliseCode, type Coupon, type Sku } from '@/lib/pricing/resolvePrice';

/**
 * Coupon lookup and the reserve → burn → release lifecycle.
 *
 * The pricing decision itself lives in lib/pricing/resolvePrice.ts and is a pure
 * function with 60 tests. This module only answers "which coupon is this, how
 * many times has it been used, and hold/settle that use" — nothing here decides
 * an amount.
 */

/** How long a reserved-but-unpaid redemption keeps holding its use. */
export const RESERVATION_MINUTES = 30;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Redemptions that still count against maxUses: burned, or reserved and fresh. */
function stillCounts() {
  return or(
    eq(couponRedemptions.state, 'burned'),
    and(
      eq(couponRedemptions.state, 'reserved'),
      gt(couponRedemptions.reservedUntil, sql`now()`),
    ),
  );
}

/**
 * Find a coupon by the code a student typed.
 *
 * Trimmed and uppercased before comparison, because these are read off a screen
 * and typed by hand. Returns null for an unknown code — the caller reports that
 * as "not a valid code", distinct from resolvePrice's reasons for refusing a
 * code that does exist.
 */
export async function findCoupon(runner: Tx | typeof db, rawCode: string): Promise<Coupon | null> {
  const code = normaliseCode(rawCode);
  if (!code) return null;

  const [row] = await runner.select().from(coupons).where(eq(coupons.code, code)).limit(1);
  if (!row) return null;

  return {
    id: row.id,
    code: row.code,
    type: row.type,
    value: row.value,
    appliesTo: row.appliesTo as Sku[],
    minAmount: row.minAmount,
    maxUses: row.maxUses,
    maxPerPerson: row.maxPerPerson,
    validFrom: row.validFrom,
    validUntil: row.validUntil,
    enabled: row.enabled,
  };
}

/** How many times this coupon has been used in total, and by this person. */
export async function couponUsage(
  runner: Tx | typeof db,
  couponId: number,
  email: string,
  contact: string,
): Promise<{ total: number; byPerson: number }> {
  const [row] = await runner
    .select({
      total: sql<number>`count(*)::int`,
      byPerson: sql<number>`count(*) filter (
        where lower(${couponRedemptions.email}) = lower(${email})
           or ${couponRedemptions.contact} = ${contact}
      )::int`,
    })
    .from(couponRedemptions)
    .where(and(eq(couponRedemptions.couponId, couponId), stillCounts()));

  return { total: Number(row?.total ?? 0), byPerson: Number(row?.byPerson ?? 0) };
}

/**
 * Hold a use of this coupon for an order that has not been paid yet.
 *
 * Called inside the same transaction as the registration insert, so a coupon
 * cannot be over-redeemed by two concurrent checkouts: the caller has already
 * locked the track rows, and the usage count is read in that same transaction.
 */
export async function reserveCoupon(
  tx: Tx,
  args: { couponId: number; orderId: string; email: string; contact: string; amountOff: number },
): Promise<void> {
  await tx.insert(couponRedemptions).values({
    couponId: args.couponId,
    orderId: args.orderId,
    email: args.email,
    contact: args.contact,
    amountOff: args.amountOff,
    state: 'reserved',
    reservedUntil: sql`now() + make_interval(mins => ${RESERVATION_MINUTES})`,
  });
}

/**
 * Settle a reservation once the payment succeeded.
 *
 * Idempotent: the webhook is retried by Cashfree, and `UNIQUE(couponId, orderId)`
 * plus this narrow WHERE mean a second call updates nothing rather than burning
 * a second use.
 */
export async function burnRedemption(orderId: string): Promise<void> {
  await db
    .update(couponRedemptions)
    .set({ state: 'burned', reservedUntil: null })
    .where(and(eq(couponRedemptions.orderId, orderId), eq(couponRedemptions.state, 'reserved')));
}

/**
 * Give the use back after a failed or abandoned payment.
 *
 * Only ever moves `reserved` → `released`, so a late failure callback arriving
 * after a successful payment cannot un-burn a legitimate redemption.
 */
export async function releaseRedemption(orderId: string): Promise<void> {
  await db
    .update(couponRedemptions)
    .set({ state: 'released', reservedUntil: null })
    .where(and(eq(couponRedemptions.orderId, orderId), eq(couponRedemptions.state, 'reserved')));
}

/**
 * Resolve a referrer code to its id, or null.
 *
 * Attribution only — this never affects the price. An inactive or unknown code
 * is silently ignored rather than rejected: a typo in an optional field must not
 * block someone from registering.
 */
export async function findReferrerId(rawCode: string | null | undefined): Promise<number | null> {
  if (!rawCode?.trim()) return null;
  const [row] = await db
    .select({ id: referrers.id })
    .from(referrers)
    .where(and(eq(referrers.code, normaliseCode(rawCode)), eq(referrers.active, true)))
    .limit(1);
  return row?.id ?? null;
}

// ─── bulk generation ─────────────────────────────────────────────────────────

/**
 * Alphabet for generated codes.
 *
 * 0/O and 1/I/L are excluded: these get read off a screen, written on a
 * whiteboard, and typed by hand. Ambiguous glyphs turn into support messages.
 */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export function generateCode(prefix: string, length = 5): string {
  let out = '';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return `${normaliseCode(prefix)}${out}`;
}

/**
 * Generate `count` distinct codes sharing one rule set.
 *
 * Collisions are handled by the unique index rather than by checking first:
 * inserting with ON CONFLICT DO NOTHING and re-generating the shortfall is
 * race-free, whereas "SELECT then INSERT" is not.
 */
export async function generateBatch(
  count: number,
  prefix: string,
  batchId: string,
  rules: Omit<typeof coupons.$inferInsert, 'code' | 'batchId'>,
): Promise<string[]> {
  const made: string[] = [];
  for (let attempt = 0; attempt < 10 && made.length < count; attempt++) {
    const want = count - made.length;
    const candidates = Array.from({ length: want }, () => generateCode(prefix));
    const inserted = await db
      .insert(coupons)
      .values(candidates.map((code) => ({ ...rules, code, batchId })))
      .onConflictDoNothing({ target: coupons.code })
      .returning({ code: coupons.code });
    made.push(...inserted.map((r) => r.code));
  }
  return made;
}

/** Every code in a batch, for the CSV export. */
export async function batchCodes(batchId: string) {
  return db.select().from(coupons).where(eq(coupons.batchId, batchId)).orderBy(coupons.code);
}

/** Usage counts for a set of coupons, in one grouped query rather than N. */
export async function usageForCoupons(couponIds: number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>(couponIds.map((id) => [id, 0]));
  if (couponIds.length === 0) return out;

  const rows = await db
    .select({ couponId: couponRedemptions.couponId, n: sql<number>`count(*)::int` })
    .from(couponRedemptions)
    .where(and(inArray(couponRedemptions.couponId, couponIds), stillCounts()))
    .groupBy(couponRedemptions.couponId);

  for (const r of rows) out.set(r.couponId, Number(r.n));
  return out;
}
