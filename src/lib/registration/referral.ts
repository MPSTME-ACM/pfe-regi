import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import { referrers } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { normaliseCode } from '@/lib/pricing/resolvePrice';

// ─────────────────────────────────────────────────────────────────────────────
// Referral attribution.
//
// The typed "Referral" field cannot be the only channel: it is optional, it is
// near the bottom of a long form, and a buyer who was sent by someone has no
// reason to remember a code they were never told to keep. Anything that relies
// on a person retyping a string will lose some fraction of its attributions, and
// the ones it loses are invisible — nobody files a bug for a signup that was
// merely credited to no one.
//
// So a referrer gets a LINK. /r/ACM-SNDT-CAMPUS drops an httpOnly cookie and
// sends them to the form. Attribution is then read on the SERVER at checkout and
// never has to survive a round trip through the browser's form state.
//
// Precedence is deliberate and one-directional: a code typed into the field wins
// over the cookie. The cookie only fills a gap. The reverse — a cookie silently
// overriding what someone typed, or re-attributing after they cleared the box —
// would make the field a lie, and this is the sort of thing people are paid on.
// That is also why the link's attribution is shown as READ-ONLY TEXT rather than
// prefilled into the input: there is nothing to delete, so deleting it cannot
// mean two different things.
// ─────────────────────────────────────────────────────────────────────────────

export const REFERRAL_COOKIE = 'pfe_ref';

/** Attribution window. A poster seen in week one should still count in week two. */
export const REFERRAL_MAX_AGE_DAYS = 30;

/**
 * Codes have to survive being printed on a poster and typed into an address bar,
 * so they are restricted to a URL-safe alphabet. `normaliseCode` only trims and
 * uppercases — without this an admin could create "ACM SNDT" or "ACM/SNDT", both
 * of which are valid rows whose link could never work.
 */
const CODE_RE = /^[A-Z0-9][A-Z0-9-]{1,38}[A-Z0-9]$/;

export function isValidReferrerCode(code: string): boolean {
  return CODE_RE.test(normaliseCode(code));
}

export interface ReferrerRef {
  id: number;
  code: string;
  name: string;
}

/** An ACTIVE referrer by code, case-insensitively. Null for unknown or disabled. */
export async function findReferrer(rawCode: string | null | undefined): Promise<ReferrerRef | null> {
  if (!rawCode?.trim()) return null;
  const [row] = await db
    .select({ id: referrers.id, code: referrers.code, name: referrers.name })
    .from(referrers)
    .where(and(eq(referrers.code, normaliseCode(rawCode)), eq(referrers.active, true)))
    .limit(1);
  return row ?? null;
}

/** The code currently held in the visitor's cookie, if any. */
export async function referralCookieCode(): Promise<string | null> {
  const store = await cookies();
  return store.get(REFERRAL_COOKIE)?.value?.trim() || null;
}

/**
 * Who to credit for an order.
 *
 * Typed field first, cookie second. Deliberately forgiving at both ends: an
 * unknown or deactivated code is ignored rather than rejected, because a typo in
 * an optional field must never stop somebody registering and paying.
 */
export async function resolveReferrerId(typed: string | null | undefined): Promise<number | null> {
  if (typed?.trim()) {
    const explicit = await findReferrer(typed);
    // Note the early return: a typed code that turns out to be invalid does NOT
    // fall through to the cookie. Someone who typed something meant that, and
    // quietly crediting a different referrer instead is worse than crediting none.
    return explicit?.id ?? null;
  }
  const fromCookie = await referralCookieCode();
  return fromCookie ? ((await findReferrer(fromCookie))?.id ?? null) : null;
}
