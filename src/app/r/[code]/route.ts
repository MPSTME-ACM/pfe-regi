import { NextResponse } from 'next/server';
import {
  findReferrer,
  isValidReferrerCode,
  REFERRAL_COOKIE,
  REFERRAL_MAX_AGE_DAYS,
} from '@/lib/registration/referral';

// ─────────────────────────────────────────────────────────────────────────────
// GET /r/<CODE> — claim a referral, then go to the form.
//
// A Route Handler rather than a page because this has to SET a cookie, and a
// server component cannot: Next only allows cookie writes from route handlers,
// server actions and middleware.
//
// Namespaced under /r/ rather than living at the root. A root-level [code]
// catch-all would swallow every mistyped URL — /abuot-us would silently render
// the registration form instead of 404ing — and the day someone adds a real
// route whose name matches an existing referrer code, that referrer's link
// breaks with no error anywhere. /r/ACM-SNDT-CAMPUS is barely longer and cannot
// collide with anything.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const decoded = decodeURIComponent(code || '');

  // Always land on the form. A bad link is someone standing in front of a poster
  // with their phone out — sending them to a 404 loses a registration to punish
  // a typo that was probably ours. They simply arrive unattributed.
  const home = new URL('/', request.url);

  if (!isValidReferrerCode(decoded)) {
    return NextResponse.redirect(home, { status: 307 });
  }

  const referrer = await findReferrer(decoded);
  if (!referrer) {
    // Unknown or deactivated. Clear any previous claim rather than leaving a
    // stale one: following a dead link should not credit whoever came before.
    const res = NextResponse.redirect(home, { status: 307 });
    res.cookies.delete(REFERRAL_COOKIE);
    return res;
  }

  const res = NextResponse.redirect(home, { status: 307 });
  res.cookies.set(REFERRAL_COOKIE, referrer.code, {
    // httpOnly is the whole point: attribution is read on the server at
    // checkout, so it cannot be lost by form state, a refresh, or the buyer
    // never noticing there was a referral at all.
    httpOnly: true,
    sameSite: 'lax', // 'strict' would drop the cookie on this inbound navigation
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: REFERRAL_MAX_AGE_DAYS * 24 * 60 * 60,
  });
  return res;
}
