import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { registrations, tracks, type Track } from '@/lib/db/schema';
import { requireStaff } from '@/lib/auth/requireAdmin';
import { CAPSTONE_SLUG, type TrackSelection } from '@/lib/registration/capacity';
import { daysForRegistration } from '@/lib/registration/lookupTicket';
import type { RosterTicket } from '@/lib/verify/roster';

// ─────────────────────────────────────────────────────────────────────────────
// The offline roster: every live 2026 registration in one compact response.
//
// Door phones lose network mid-event. The scanner downloads this while online
// (right after login, or via Refresh), caches it on-device, and then resolves
// scans and verdicts locally. Attendance marked offline is queued client-side
// and replayed through POST /api/verify/batch.
//
// One registrations query + one tracks query, regardless of row count —
// lookupTicket's per-row helpers are N+1 by design and are not used here.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  try {
    const auth = requireStaff(request);
    if (!auth.ok) {
      console.warn('verify roster auth rejected', request.headers.get('user-agent') ?? 'no-ua');
      return auth.response;
    }

    const [rows, allTracks] = await Promise.all([
      db.select().from(registrations),
      db.select().from(tracks),
    ]);

    const byId = new Map<number, Track>(allTracks.map((t) => [t.id, t]));
    const capstone = allTracks.find((t) => t.slug === CAPSTONE_SLUG) ?? null;

    const tickets: RosterTicket[] = rows.map((row) => {
      const sel: TrackSelection = {
        sku: row.sku,
        beginnerTrack: row.beginnerTrackId ? (byId.get(row.beginnerTrackId) ?? null) : null,
        advancedTrack: row.advancedTrackId ? (byId.get(row.advancedTrackId) ?? null) : null,
        capstoneTrack: row.hasCapstone ? capstone : null,
      };
      // Same entitlement fallback as lookupTicket: if every track resolved to
      // nothing, daysForRegistration falls back to the stored attendance keys
      // so the door still gets checkboxes for a real ticket.
      const names = [
        sel.beginnerTrack?.name,
        sel.advancedTrack?.name,
        sel.capstoneTrack?.name,
      ].filter((n): n is string => !!n);
      return {
        edition: 2026 as const,
        readOnly: false as const,
        name: row.name,
        orderId: row.orderId,
        course: row.course,
        year: row.year,
        department: row.department,
        description: names.join(' + ') || row.sku,
        sku: row.sku,
        hasCapstone: row.hasCapstone,
        paymentStatus: row.paymentStatus,
        days: daysForRegistration(row, sel),
      };
    });

    return NextResponse.json({
      success: true,
      fetchedAt: new Date().toISOString(),
      count: tickets.length,
      tickets,
    });
  } catch (error) {
    console.error('Verify roster API Error:', error);
    return NextResponse.json({ success: false, message: 'Internal Server Error' }, { status: 500 });
  }
}
