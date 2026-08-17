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

/**
 * 307 to the form, with a RELATIVE Location.
 *
 * Always land on the form: a bad link is someone standing in front of a poster
 * with their phone out, and sending them to a 404 loses a registration to punish
 * a typo that was probably ours. They simply arrive unattributed.
 *
 * The origin is deliberately absent. This used to be `new URL('/', request.url)`,
 * and behind the Coolify proxy `request.url` is the container's own address, so
 * every poster scan 307'd to `https://localhost:3000/` — the cookie was set
 * correctly and the buyer still never reached the form.
 *
 * `siteUrl()` would fix the host but throws when SITE_URL is unset, turning the
 * same link into a 500. A relative Location (legal per RFC 7231, resolved by the
 * browser against the address it actually typed) depends on no configuration at
 * all. `NextResponse.redirect()` rejects a relative string, hence the manual
 * Location header — `res.cookies` still works on the instance.
 */
function home(): NextResponse {
  return new NextResponse(null, { status: 307, headers: { Location: '/' } });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const decoded = decodeURIComponent(code || '');

  if (!isValidReferrerCode(decoded)) {
    return home();
  }

  const referrer = await findReferrer(decoded);
  if (!referrer) {
    // Unknown or deactivated. Clear any previous claim rather than leaving a
    // stale one: following a dead link should not credit whoever came before.
    const res = home();
    // The path MUST be repeated. A Set-Cookie emitted from /r/<CODE> defaults to
    // a path of /r, which does not match the /-scoped cookie we are trying to
    // clear — the dead link would leave the previous referrer's claim standing.
    res.cookies.delete({ name: REFERRAL_COOKIE, path: '/' });
    return res;
  }

  const res = home();
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
