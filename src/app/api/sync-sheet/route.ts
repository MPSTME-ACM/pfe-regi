import { NextResponse } from 'next/server';
import { requireAdmin, hasCronToken } from '@/lib/auth/requireAdmin';
import { runSheetSync, syncHistory } from '@/lib/registration/runSheetSync';

/**
 * Trigger a sheet sync, and report on past ones.
 *
 * All the work is in `lib/registration/runSheetSync` so the in-process scheduler
 * can call it without going through HTTP. This file is auth and status codes.
 */

export const dynamic = 'force-dynamic';

/** Enough to identify a machine caller, short enough to sit in a table cell. */
function userAgent(request: Request): string {
  return request.headers.get('user-agent')?.slice(0, 200) || 'unknown';
}

/**
 * A rejected Bearer token would otherwise fall through to the Basic-auth
 * decoder, which base64-decodes the token, finds no colon in the result and
 * answers `400 Malformed authorization header`. That reads as "my curl is
 * wrong" when the real cause is almost always an unset or mismatched
 * CRON_SECRET — or, as happened here, a server still running an older build
 * that has no bearer support at all.
 */
function bearerRejection(request: Request, detail: string): NextResponse | null {
  if (!request.headers.get('authorization')?.toLowerCase().startsWith('bearer ')) return null;
  return NextResponse.json({ success: false, message: detail }, { status: 401 });
}

export async function POST(request: Request) {
  if (!hasCronToken(request)) {
    const admin = requireAdmin(request);
    if (!admin.ok) {
      // Logged, and that is the entire point of this line. Before it existed a
      // trigger with a stale password was rejected in complete silence: no
      // error, no counter, nothing to distinguish "the cron is 401ing" from
      // "the cron was never firing at all". Deliberately not written to
      // `sync_runs` — an unauthenticated request must not be able to grow a
      // table.
      console.warn('[SYNC] rejected unauthenticated trigger', { userAgent: userAgent(request) });

      return (
        bearerRejection(
          request,
          'Bearer token rejected. Check CRON_SECRET is set on the server and matches this token.',
        ) ?? admin.response
      );
    }
  }

  const result = await runSheetSync('http', userAgent(request));

  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    message: result.message,
    skipped: result.skipped,
  });
}

/**
 * Recent runs, for the panel on /sync and the staleness banner on /admin.
 *
 * Admin only — the run log names the User-Agent of every caller, and a bearer
 * token is for firing the sync, not for reading who else has been firing it.
 */
export async function GET(request: Request) {
  const auth = requireAdmin(request);
  if (!auth.ok) {
    return (
      bearerRejection(request, 'Reading the run log needs admin credentials, not CRON_SECRET.') ??
      auth.response
    );
  }

  const history = await syncHistory();
  return NextResponse.json({ success: true, ...history });
}
