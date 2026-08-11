import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { referrers } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { normaliseCode } from '@/lib/pricing/resolvePrice';
import { isValidReferrerCode } from '@/lib/registration/referral';

export const dynamic = 'force-dynamic';

// ─────────────────────────────────────────────────────────────────────────────
// Create and deactivate referrers.
//
// This did not exist before, which is why the Referral field had never credited
// anybody in production: `findReferrer` matches against a table nothing could
// write to, so every code typed into that box resolved to null. The read-only
// leaderboard in api/admin/coupons was reporting on rows that could not be made.
//
// Whitelist validation, same as api/admin/settings and api/admin/coupons.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_NAME = 120;

function bad(message: string, status = 400) {
  return NextResponse.json({ success: false, message }, { status });
}

/** Drizzle wraps the pg error, so match the SQLSTATE rather than the message. */
function isUniqueViolation(error: unknown): boolean {
  const cause = (error as { cause?: unknown })?.cause ?? error;
  return (cause as { code?: string })?.code === '23505';
}

export async function GET(request: Request) {
  const auth = requireAdmin(request);
  if (!auth.ok) return auth.response;

  const rows = await db.select().from(referrers).orderBy(referrers.code);
  return NextResponse.json({ success: true, referrers: rows });
}

export async function POST(request: Request) {
  const auth = requireAdmin(request);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bad('Invalid JSON body');
  }
  const o = (body ?? {}) as Record<string, unknown>;

  if (typeof o.code !== 'string' || typeof o.name !== 'string') {
    return bad('code and name are required');
  }

  const code = normaliseCode(o.code);
  const name = o.name.trim();

  // Rejected rather than silently rewritten. A code is half of a URL that gets
  // printed on a poster; quietly turning "ACM SNDT" into something else would
  // hand the admin a link they never chose and cannot predict.
  if (!isValidReferrerCode(code)) {
    return bad(
      'Code must be 3-40 characters of letters, numbers and hyphens, starting and ending with a letter or number (e.g. ACM-SNDT-CAMPUS).',
    );
  }
  if (!name || name.length > MAX_NAME) {
    return bad(`name must be 1-${MAX_NAME} characters`);
  }

  try {
    const [row] = await db.insert(referrers).values({ code, name }).returning();
    return NextResponse.json({ success: true, referrer: row });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return bad(`The code ${code} is already in use.`, 409);
    }
    console.error('[referrers] create failed:', error);
    return NextResponse.json({ success: false, message: 'Failed to create referrer' }, { status: 500 });
  }
}

/**
 * Flip `active`.
 *
 * Deactivating is the only removal there is, and that is on purpose: rows in
 * `pferegistration` point at these by id, so deleting one would either orphan
 * past attributions or take them with it. An inactive referrer stops matching
 * new links and keeps every signup it already earned.
 */
export async function PATCH(request: Request) {
  const auth = requireAdmin(request);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bad('Invalid JSON body');
  }
  const o = (body ?? {}) as Record<string, unknown>;

  if (typeof o.id !== 'number' || !Number.isInteger(o.id)) return bad('id must be an integer');
  if (typeof o.active !== 'boolean') return bad('active must be a boolean');

  const [row] = await db
    .update(referrers)
    .set({ active: o.active })
    .where(eq(referrers.id, o.id))
    .returning();

  if (!row) return bad('No such referrer', 404);
  return NextResponse.json({ success: true, referrer: row });
}
