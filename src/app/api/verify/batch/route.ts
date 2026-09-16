import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { registrations, tracks, type Registration, type Track } from '@/lib/db/schema';
import { eq, inArray, sql } from 'drizzle-orm';
import { requireStaff } from '@/lib/auth/requireAdmin';
import { CAPSTONE_SLUG, type TrackSelection } from '@/lib/registration/capacity';
import { daysForRegistration } from '@/lib/registration/lookupTicket';
import type { BatchItemResult } from '@/lib/verify/outbox';

// ─────────────────────────────────────────────────────────────────────────────
// Batch attendance writes: the flush target for the door scanner's offline
// outbox. One HTTP round trip for up to MAX_BATCH queued marks, so a volunteer
// emerging from a dead zone syncs a whole queue in a single request instead of
// one POST per ticket.
//
// Semantics are identical to POST /api/verify, applied per item: entitlement
// filtering (a scanner cannot invent a day), jsonb `||` merge (two doors
// touching the same row cannot undo each other), per-item results. Items are
// independent — one bad orderId does not fail the rest.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_BATCH = 100;

function selectionFor(
  row: Registration,
  byId: Map<number, Track>,
  capstone: Track | null,
): TrackSelection {
  return {
    sku: row.sku,
    beginnerTrack: row.beginnerTrackId ? (byId.get(row.beginnerTrackId) ?? null) : null,
    advancedTrack: row.advancedTrackId ? (byId.get(row.advancedTrackId) ?? null) : null,
    capstoneTrack: row.hasCapstone ? capstone : null,
  };
}

export async function POST(request: Request) {
  try {
    const auth = requireStaff(request);
    if (!auth.ok) {
      console.warn('verify batch auth rejected', request.headers.get('user-agent') ?? 'no-ua');
      return auth.response;
    }

    const body = await request.json().catch(() => null);
    const updates = body?.updates;
    if (!Array.isArray(updates) || updates.length === 0) {
      return NextResponse.json(
        { success: false, message: 'updates must be a non-empty array' },
        { status: 400 },
      );
    }
    if (updates.length > MAX_BATCH) {
      return NextResponse.json(
        { success: false, message: `updates is capped at ${MAX_BATCH} items` },
        { status: 400 },
      );
    }

    // Validate shape first, so one malformed item fails only itself.
    const valid: { orderId: string; patch: Record<string, unknown> }[] = [];
    const results: BatchItemResult[] = [];
    for (const u of updates) {
      const orderId = u?.orderId;
      const attendance = u?.attendance;
      if (
        typeof orderId !== 'string' ||
        !orderId ||
        !attendance ||
        typeof attendance !== 'object' ||
        Array.isArray(attendance)
      ) {
        if (typeof orderId === 'string' && orderId) {
          results.push({ orderId, ok: false, error: 'invalid', message: 'Invalid item shape' });
        }
        continue;
      }
      valid.push({ orderId, patch: attendance as Record<string, unknown> });
    }

    // One round trip for the rows, one for the tracks — not per item.
    const byOrderId = new Map<string, Registration>();
    if (valid.length > 0) {
      const ids = [...new Set(valid.map((v) => v.orderId))];
      const rows = await db.select().from(registrations).where(inArray(registrations.orderId, ids));
      for (const row of rows) byOrderId.set(row.orderId, row);
    }
    const allTracks = await db.select().from(tracks);
    const byTrackId = new Map<number, Track>(allTracks.map((t) => [t.id, t]));
    const capstone = allTracks.find((t) => t.slug === CAPSTONE_SLUG) ?? null;

    for (const { orderId, patch } of valid) {
      const row = byOrderId.get(orderId);
      if (!row) {
        // 2025 rows live in the archive, which is read-only, and unknown ids
        // are typos — either way there is nothing to write. The client drops
        // the queued item instead of retrying forever.
        results.push({ orderId, ok: false, error: 'not_found', message: 'Ticket not found' });
        continue;
      }

      try {
        const sel = selectionFor(row, byTrackId, capstone);
        const entitled = new Set(daysForRegistration(row, sel).map((d) => d.key));
        const filtered: Record<string, boolean> = {};
        for (const [date, present] of Object.entries(patch)) {
          if (entitled.has(date)) filtered[date] = Boolean(present);
        }

        const [updated] = await db
          .update(registrations)
          .set({
            attendance: sql`${registrations.attendance} || ${JSON.stringify(filtered)}::jsonb`,
          })
          .where(eq(registrations.orderId, orderId))
          .returning({ attendance: registrations.attendance });

        results.push({
          orderId,
          ok: true,
          attendance: (updated?.attendance ?? { ...(row.attendance ?? {}), ...filtered }) as Record<
            string,
            boolean
          >,
        });
      } catch (error) {
        console.error('verify batch item failed', orderId, error);
        results.push({ orderId, ok: false, error: 'server', message: 'Failed to save' });
      }
    }

    return NextResponse.json({ success: true, results });
  } catch (error) {
    console.error('Verify batch API Error:', error);
    return NextResponse.json({ success: false, message: 'Internal Server Error' }, { status: 500 });
  }
}
