import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { coupons, couponRedemptions, referrers, registrations } from '@/lib/db/schema';
import { desc, eq, sql } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { generateBatch, usageForCoupons } from '@/lib/registration/coupons';
import { normaliseCode, type CouponType, type Sku } from '@/lib/pricing/resolvePrice';

export const dynamic = 'force-dynamic';

// Coupons, redemptions and the referrer leaderboard.
//
// Validation is whitelist-only and hand-rolled, matching api/admin/settings:
// anything not named here is dropped, so a client cannot smuggle in an id or a
// createdAt. See that file for the reasoning.

const TYPES: CouponType[] = ['percent', 'flat', 'fixed', 'free'];
const SKUS: Sku[] = ['capstone', 'single', 'bundle'];
const MAX_VALUE_PAISE = 10_000_00;
const MAX_BATCH = 500;

function bad(message: string, status = 400) {
  return NextResponse.json({ success: false, message }, { status });
}

/**
 * Postgres unique_violation (SQLSTATE 23505).
 *
 * Drizzle wraps the driver error, so the code can be on the error itself or on
 * its `cause`. Both are checked.
 */
function isUniqueViolation(error: unknown): boolean {
  const codeOf = (e: unknown) =>
    typeof e === 'object' && e !== null && 'code' in e ? (e as { code?: unknown }).code : undefined;
  if (codeOf(error) === '23505') return true;
  const cause = typeof error === 'object' && error !== null && 'cause' in error
    ? (error as { cause?: unknown }).cause
    : undefined;
  return codeOf(cause) === '23505';
}

interface CouponInput {
  code?: unknown; type?: unknown; value?: unknown; appliesTo?: unknown;
  minAmount?: unknown; maxUses?: unknown; maxPerPerson?: unknown;
  validFrom?: unknown; validUntil?: unknown; enabled?: unknown; note?: unknown;
}

/** Null means "no limit" and is distinct from 0. Rejects anything else. */
function optionalInt(v: unknown, field: string, errors: string[], max = MAX_VALUE_PAISE) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > max) {
    errors.push(`${field} must be a whole number between 0 and ${max}, or empty for no limit`);
    return null;
  }
  return v;
}

function optionalDate(v: unknown, field: string, errors: string[]) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string') { errors.push(`${field} must be a date string`); return null; }
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) { errors.push(`${field} is not a valid date`); return null; }
  return d;
}

function parseRules(body: CouponInput, errors: string[]) {
  const type = TYPES.includes(body.type as CouponType) ? (body.type as CouponType) : null;
  if (!type) errors.push(`type must be one of ${TYPES.join(', ')}`);

  let value = 0;
  if (type === 'percent') {
    const v = body.value;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 100) {
      errors.push('A percent coupon needs a whole number from 1 to 100');
    } else value = v;
  } else if (type === 'flat' || type === 'fixed') {
    const v = body.value;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > MAX_VALUE_PAISE) {
      errors.push(`A ${type} coupon needs an amount in paise (₹250 is 25000)`);
    } else value = v;
  }
  // 'free' ignores value entirely.

  let appliesTo: Sku[] = [];
  if (body.appliesTo !== undefined) {
    if (!Array.isArray(body.appliesTo) || !body.appliesTo.every((s) => SKUS.includes(s as Sku))) {
      errors.push('appliesTo must be a list of skus (empty means all)');
    } else appliesTo = body.appliesTo as Sku[];
  }

  const validFrom = optionalDate(body.validFrom, 'validFrom', errors);
  const validUntil = optionalDate(body.validUntil, 'validUntil', errors);
  if (validFrom && validUntil && validFrom.getTime() > validUntil.getTime()) {
    errors.push('validFrom is after validUntil, so the code could never be used');
  }

  return {
    type: type ?? 'percent',
    value,
    appliesTo,
    minAmount: optionalInt(body.minAmount, 'minAmount', errors),
    maxUses: optionalInt(body.maxUses, 'maxUses', errors, 100_000),
    maxPerPerson: optionalInt(body.maxPerPerson, 'maxPerPerson', errors, 1000),
    validFrom,
    validUntil,
    enabled: body.enabled === undefined ? true : Boolean(body.enabled),
    note: typeof body.note === 'string' ? body.note.slice(0, 500) : null,
  };
}

export async function GET(request: Request) {
  const auth = requireAdmin(request);
  if (!auth.ok) return auth.response;

  const rows = await db.select().from(coupons).orderBy(desc(coupons.createdAt));
  const used = await usageForCoupons(rows.map((r) => r.id));

  // One grouped query, not one per coupon.
  const totals = await db
    .select({
      discounted: sql<number>`coalesce(sum(${couponRedemptions.amountOff}), 0)::int`,
      burned: sql<number>`count(*) filter (where ${couponRedemptions.state} = 'burned')::int`,
    })
    .from(couponRedemptions);

  const leaderboard = await db
    .select({
      // Needed to toggle a referrer: the code is the display key but the id is
      // what api/admin/referrers PATCHes, and a code can be re-cased by hand.
      id: referrers.id,
      code: referrers.code,
      name: referrers.name,
      active: referrers.active,
      registrations: sql<number>`count(${registrations.id})::int`,
      paise: sql<number>`coalesce(sum(${registrations.amountPaid}) filter (
        where ${registrations.paymentStatus} in ('success','comped')), 0)::int`,
    })
    .from(referrers)
    .leftJoin(registrations, eq(registrations.referrerId, referrers.id))
    .groupBy(referrers.id, referrers.code, referrers.name, referrers.active)
    .orderBy(desc(sql`count(${registrations.id})`));

  return NextResponse.json({
    success: true,
    coupons: rows.map((r) => ({ ...r, used: used.get(r.id) ?? 0 })),
    summary: {
      totalDiscountedPaise: Number(totals[0]?.discounted ?? 0),
      burned: Number(totals[0]?.burned ?? 0),
    },
    referrers: leaderboard,
  });
}

export async function POST(request: Request) {
  const auth = requireAdmin(request);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return bad('Invalid JSON body');
  }

  const errors: string[] = [];
  const rules = parseRules(body as CouponInput, errors);

  // Bulk generation: one rule set, N codes, grouped by batchId for the export.
  if (body.generate !== undefined) {
    const count = body.generate;
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > MAX_BATCH) {
      errors.push(`generate must be a whole number from 1 to ${MAX_BATCH}`);
    }
    const prefix = typeof body.prefix === 'string' ? normaliseCode(body.prefix) : '';
    if (prefix.length > 12) errors.push('prefix must be 12 characters or fewer');
    if (errors.length) return bad(errors.join('; '));

    // Deterministic id from the prefix + row count, so no clock is needed and
    // the same batch is identifiable in the export.
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(coupons);
    const batchId = `${prefix || 'BATCH'}-${Number(n) + 1}`;

    const made = await generateBatch(count as number, prefix, batchId, rules);
    if (made.length < (count as number)) {
      console.warn(`[coupons] asked for ${count}, generated ${made.length} (code collisions)`);
    }
    return NextResponse.json({ success: true, batchId, codes: made, requested: count });
  }

  // Single named code.
  const code = typeof body.code === 'string' ? normaliseCode(body.code) : '';
  if (!code) errors.push('code is required');
  if (code.length > 40) errors.push('code must be 40 characters or fewer');
  if (errors.length) return bad(errors.join('; '));

  try {
    const [row] = await db.insert(coupons).values({ ...rules, code }).returning();
    return NextResponse.json({ success: true, coupon: { ...row, used: 0 } });
  } catch (error) {
    // The unique index is the authority on duplicates, not a prior SELECT —
    // checking first would race with a concurrent create.
    //
    // Detected by SQLSTATE, not by string-matching the message: drizzle wraps
    // the pg error, so `String(error)` is the wrapper's own text and does not
    // contain "duplicate" at all. 23505 is unique_violation.
    if (isUniqueViolation(error)) {
      return bad(`The code ${code} already exists.`, 409);
    }
    console.error('[coupons] create failed:', error);
    return bad('Failed to create the coupon', 500);
  }
}

export async function PATCH(request: Request) {
  const auth = requireAdmin(request);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return bad('Invalid JSON body');
  }

  const id = body.id;
  if (typeof id !== 'number') return bad('id is required');

  // Enable/disable is the common case and is allowed on its own, without
  // re-validating the whole rule set.
  if (Object.keys(body).length === 2 && body.enabled !== undefined) {
    const [row] = await db
      .update(coupons)
      .set({ enabled: Boolean(body.enabled) })
      .where(eq(coupons.id, id))
      .returning();
    if (!row) return bad('No such coupon', 404);
    return NextResponse.json({ success: true, coupon: row });
  }

  const errors: string[] = [];
  const rules = parseRules(body as CouponInput, errors);
  if (errors.length) return bad(errors.join('; '));

  const [row] = await db.update(coupons).set(rules).where(eq(coupons.id, id)).returning();
  if (!row) return bad('No such coupon', 404);
  return NextResponse.json({ success: true, coupon: row });
}
