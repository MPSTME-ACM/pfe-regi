import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { registrations, tracks } from '@/lib/db/schema';
import { inArray } from 'drizzle-orm';
import { requireMember } from '@/lib/auth/requireAdmin';
import { generateOrderId } from '@/lib/registration/orderId';
import { completeWithoutPayment } from '@/lib/registration/completeWithoutPayment';
import {
  CAPSTONE_SLUG,
  SKUS,
  initialAttendance,
  resolveSelection,
  soldCapstone,
  soldPerTrack,
  tracksToReserve,
} from '@/lib/registration/capacity';
import type { Sku } from '@/lib/pricing/resolvePrice';

// ─────────────────────────────────────────────────────────────────────────────
// Comped ACM registrations — no payment, ticket issued directly.
//
// STILL DISABLED (`route.disabled.ts` is not routed by Next). The /member flow
// is rebuilt later in phase 2; this is kept compiling and correct against the
// new schema so re-enabling it is a rename rather than a rewrite.
//
// Two things changed from 2025:
//   - comps are written as `comped`, not `failure`. The old trick made them
//     dodge the capacity check but also made them indistinguishable from real
//     payment failures, which skewed every percentage on /stats.
//   - because they are `comped`, they DO occupy a seat, so they go through the
//     same locked capacity check as a paying registration.
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const auth = requireMember(request);
    if (!auth.ok) return auth.response;

    const body = await request.json();
    if (!body?.sku || !SKUS.includes(body.sku as Sku)) {
      return NextResponse.json({ success: false, message: 'Invalid sku' }, { status: 400 });
    }

    const wanted = [body.beginnerTrack, body.advancedTrack, CAPSTONE_SLUG].filter(
      (s): s is string => typeof s === 'string' && s.length > 0,
    );
    const found = await db.select().from(tracks).where(inArray(tracks.slug, wanted));
    const selection = resolveSelection(
      body.sku as Sku,
      body.beginnerTrack,
      body.advancedTrack,
      new Map(found.map((t) => [t.slug, t])),
    );
    if (typeof selection === 'string') {
      return NextResponse.json({ success: false, message: selection }, { status: 400 });
    }

    const orderId = generateOrderId('ACM');
    const reserve = tracksToReserve(selection);

    const outcome = await db.transaction(async (tx) => {
      const locked = await tx
        .select()
        .from(tracks)
        .where(inArray(tracks.id, reserve.map((t) => t.id)))
        .for('update');
      const lockedById = new Map(locked.map((t) => [t.id, t]));
      const sold = await soldPerTrack(tx, reserve.filter((t) => t.slug !== CAPSTONE_SLUG).map((t) => t.id));
      const capstoneSold = selection.capstoneTrack ? await soldCapstone(tx) : 0;

      for (const t of reserve) {
        const current = lockedById.get(t.id);
        if (!current?.enabled) return { full: t.name } as const;
        const used = t.slug === CAPSTONE_SLUG ? capstoneSold : (sold.get(t.id) ?? 0);
        if (used >= current.capacity) return { full: current.name } as const;
      }

      await tx.insert(registrations).values({
        name: `ACM - ${body.name}`,
        email: body.email,
        contact: body.contact,
        college: body.college ?? '',
        course: body.course,
        department: body.department,
        year: body.year,
        sku: selection.sku,
        beginnerTrackId: selection.beginnerTrack?.id ?? null,
        advancedTrackId: selection.advancedTrack?.id ?? null,
        hasCapstone: selection.capstoneTrack !== null,
        amountPaid: 0,
        attendance: initialAttendance(selection),
        orderId,
        paymentStatus: 'pending',
      });
      return { full: null } as const;
    });

    if (outcome.full) {
      return NextResponse.json(
        { success: false, message: `${outcome.full} is full.`, error: 'TRACK_FULL' },
        { status: 400 },
      );
    }

    await completeWithoutPayment(orderId);
    return NextResponse.json({ success: true, order_id: orderId });
  } catch (error) {
    console.error('[member-register]', error);
    return NextResponse.json({ success: false, message: 'Internal Server Error' }, { status: 500 });
  }
}
