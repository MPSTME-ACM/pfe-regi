import { NextResponse } from 'next/server';
import { trackAvailability } from '@/lib/registration/capacity';

/**
 * Public track availability for the registration form.
 *
 * Kept at the old `/api/domain-count` path so a stale cached page does not 404;
 * the payload is new. `registrationAllowed` is retained as a slug -> boolean map
 * for the same reason.
 *
 * The 5-minute in-memory cache that used to live here is gone on purpose. It was
 * per-container, so two instances disagreed, and its staleness is exactly why a
 * student could pick a track the server then rejected as full. One grouped query
 * over an indexed column is cheap enough to serve live.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const tracks = await trackAvailability();
    return NextResponse.json({
      success: true,
      tracks,
      registrationAllowed: Object.fromEntries(tracks.map((t) => [t.slug, !t.full])),
    });
  } catch (error) {
    console.error('[domain-count]', error);
    return NextResponse.json({ success: false, message: 'Internal Server Error' }, { status: 500 });
  }
}
