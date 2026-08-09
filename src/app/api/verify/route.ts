import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { registrations } from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { lookupTicket } from '@/lib/registration/lookupTicket';

// ─────────────────────────────────────────────────────────────────────────────
// The door scanner's endpoint. Reads a ticket, and marks attendance on it.
//
// Attendance is a date-keyed map, not a positional boolean[3]: a capstone-only
// buyer attends one day and a bundle buyer attends five, so an index means
// nothing. The set of writable dates is derived from the registration's SKU and
// its tracks' dates — a scanner cannot invent a day, and cannot mark someone
// present for a day they did not buy.
//
// 2025 QR codes are still in circulation. They resolve from the archive table
// and are strictly read-only.
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const auth = requireAdmin(request);
    if (!auth.ok) return auth.response;

    const { orderId, attendance } = await request.json();

    if (!orderId || typeof orderId !== 'string') {
      return NextResponse.json({ success: false, message: 'Order ID is required' }, { status: 400 });
    }

    const found = await lookupTicket(orderId);
    if (!found) {
      return NextResponse.json(
        { success: false, message: 'Ticket not found or invalid' },
        { status: 404 },
      );
    }

    const wantsWrite = attendance && typeof attendance === 'object' && !Array.isArray(attendance);

    // Read.
    if (!wantsWrite) {
      return NextResponse.json({ success: true, details: found.view });
    }

    // Write — but never to the archive.
    if (!found.row) {
      return NextResponse.json(
        {
          success: false,
          message: 'This is an archived 2025 registration. Its attendance cannot be edited.',
          details: found.view,
        },
        { status: 409 },
      );
    }

    const entitled = new Set(found.view.days.map((d) => d.key));

    // Only the days this ticket actually bought. Anything else in the payload is
    // dropped silently — a scanner cannot invent a day.
    const patch: Record<string, boolean> = {};
    for (const [date, present] of Object.entries(attendance as Record<string, unknown>)) {
      if (entitled.has(date)) patch[date] = Boolean(present);
    }

    // Merged in Postgres with jsonb `||`, not read-modify-written here. Two
    // volunteers scanning at two doors touch the same row on the same evening;
    // reading the map into JS and writing it back would let the slower one
    // silently undo the faster one. `||` also preserves keys the row carries but
    // is no longer entitled to — losing an attendance record is worse than
    // keeping a key nobody renders.
    const [updated] = await db
      .update(registrations)
      .set({
        attendance: sql`${registrations.attendance} || ${JSON.stringify(patch)}::jsonb`,
      })
      .where(eq(registrations.orderId, orderId))
      .returning();

    // Echo back what is actually stored, so the client renders the row rather
    // than its own optimistic state. The entitlement itself cannot have changed
    // — it comes from the tracks, which this request did not touch.
    const stored = updated?.attendance ?? { ...(found.row.attendance ?? {}), ...patch };
    const details = {
      ...found.view,
      days: found.view.days.map((d) => ({ ...d, present: Boolean(stored[d.key]) })),
    };

    return NextResponse.json({ success: true, message: 'Attendance updated', details });
  } catch (error) {
    console.error('Verification API Error:', error);
    return NextResponse.json({ success: false, message: 'Internal Server Error' }, { status: 500 });
  }
}
