// app/api/create-order/route.ts
import { NextResponse } from 'next/server';
import { Cashfree, CFEnvironment } from 'cashfree-pg';
import { db } from '@/lib/db';
import { registrations, tracks } from '@/lib/db/schema';
import { inArray } from 'drizzle-orm';
import { getSettings, paiseToRupees } from '@/lib/settings';
import { resolvePrice, type Sku } from '@/lib/pricing/resolvePrice';
import { generateOrderId } from '@/lib/registration/orderId';
import {
  CAPSTONE_SLUG,
  SKUS,
  initialAttendance,
  resolveSelection,
  soldCapstone,
  soldPerTrack,
  tracksToReserve,
} from '@/lib/registration/capacity';
import { completeWithoutPayment } from '@/lib/registration/completeWithoutPayment';

const cashfreeEnvironment =
  process.env.CASHFREE_ENV === 'PRODUCTION' ? CFEnvironment.PRODUCTION : CFEnvironment.SANDBOX;

const cashfree = new Cashfree(
  cashfreeEnvironment,
  process.env.CASHFREE_APP_ID!,
  process.env.CASHFREE_SECRET_KEY!,
);

interface Body {
  name: string; email: string; contact: string;
  college: string; course: string; department: string; year: string;
  sku: Sku;
  /** Track slugs, not ids — ids are an implementation detail the form should not carry. */
  beginnerTrack?: string | null;
  advancedTrack?: string | null;
  referral?: string | null;
}

function bad(message: string, error: string, status = 400) {
  return NextResponse.json({ success: false, message, error }, { status });
}

/** Whitelist + shape validation. The client is never trusted, least of all here. */
function validate(body: Partial<Body>): string | null {
  for (const f of ['name', 'email', 'contact', 'college', 'course', 'department', 'year'] as const) {
    if (typeof body[f] !== 'string' || !body[f]!.trim()) return `${f} is required`;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email!)) return 'A valid email is required';
  if (!/^[6-9]\d{9}$/.test(body.contact!)) return 'A valid 10-digit mobile number is required';
  if (!body.sku || !SKUS.includes(body.sku)) return 'Choose what you want to register for';
  return null;
}

export async function POST(request: Request) {
  try {
    // The registration gate. MUST be here and not only on the page: hiding the
    // form still leaves this endpoint accepting POSTs from anyone with the URL.
    const settings = await getSettings();
    if (!settings.registrationOpen) {
      return bad('Registration is currently closed.', 'REGISTRATION_CLOSED', 403);
    }

    const body = (await request.json()) as Partial<Body>;
    const invalid = validate(body);
    if (invalid) return bad(invalid, 'INVALID_INPUT');

    const wanted = [body.beginnerTrack, body.advancedTrack, CAPSTONE_SLUG].filter(
      (s): s is string => typeof s === 'string' && s.length > 0,
    );
    const found = await db.select().from(tracks).where(inArray(tracks.slug, wanted));
    const bySlug = new Map(found.map((t) => [t.slug, t]));

    const selection = resolveSelection(body.sku!, body.beginnerTrack, body.advancedTrack, bySlug);
    if (typeof selection === 'string') return bad(selection, 'INVALID_SELECTION');

    // Price is computed here and nowhere else. The browser sent no amount and
    // could not have; whatever it displayed is cosmetic.
    const price = resolvePrice({
      sku: selection.sku,
      prices: {
        capstone: settings.priceCapstone,
        single: settings.priceSingle,
        bundle: settings.priceBundle,
      },
      coupon: null, // phase 3
      now: new Date(),
    });

    const orderId = generateOrderId();
    const reserve = tracksToReserve(selection);

    // ── The capacity transaction ────────────────────────────────────────────
    // 2025 did `SELECT count()` then `INSERT` with nothing in between, so two
    // buyers at cap-1 both passed. A bundle makes that three counters at once.
    // Locking the track rows FOR UPDATE serialises concurrent buyers of the same
    // track; buyers of different tracks are unaffected.
    //
    // No network calls inside here — Cashfree is called after the commit, so a
    // slow gateway never holds these locks.
    const outcome = await db.transaction(async (tx) => {
      const locked = await tx
        .select()
        .from(tracks)
        .where(inArray(tracks.id, reserve.map((t) => t.id)))
        .for('update');

      const lockedById = new Map(locked.map((t) => [t.id, t]));
      const nonCapstoneIds = reserve.filter((t) => t.slug !== CAPSTONE_SLUG).map((t) => t.id);
      const sold = await soldPerTrack(tx, nonCapstoneIds);
      const capstoneSold = selection.capstoneTrack ? await soldCapstone(tx) : 0;

      for (const t of reserve) {
        const current = lockedById.get(t.id);
        if (!current || !current.enabled) return { full: t.name } as const;
        const used = t.slug === CAPSTONE_SLUG ? capstoneSold : (sold.get(t.id) ?? 0);
        if (used >= current.capacity) return { full: current.name } as const;
      }

      await tx.insert(registrations).values({
        name: body.name!.trim(),
        email: body.email!.trim(),
        contact: body.contact!.trim(),
        college: body.college!.trim(),
        course: body.course!.trim(),
        department: body.department!.trim(),
        year: body.year!.trim(),
        sku: selection.sku,
        beginnerTrackId: selection.beginnerTrack?.id ?? null,
        advancedTrackId: selection.advancedTrack?.id ?? null,
        hasCapstone: selection.capstoneTrack !== null,
        amountPaid: price.amount,
        attendance: initialAttendance(selection),
        orderId,
        paymentStatus: 'pending',
        referral: body.referral?.trim() || null,
      });

      return { full: null } as const;
    });

    if (outcome.full) {
      return bad(`${outcome.full} is now full. Please choose another option.`, 'TRACK_FULL');
    }

    // A 100%-off coupon (phase 3) produces a zero order. Cashfree cannot take
    // one, so it must never reach the gateway — complete it directly instead.
    if (price.amount === 0) {
      await completeWithoutPayment(orderId);
      return NextResponse.json({ success: true, order_id: orderId, free: true });
    }

    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
    const order = await cashfree.PGCreateOrder({
      order_id: orderId,
      order_amount: paiseToRupees(price.amount),
      order_currency: 'INR',
      customer_details: {
        customer_id: `customer_${body.contact}`,
        customer_name: body.name!,
        customer_email: body.email!,
        customer_phone: body.contact!,
      },
      order_meta: { notify_url: `${baseUrl}/api/webhook` },
      order_note: `PFE 2026 — ${selection.sku}`,
    });

    return NextResponse.json({
      success: true,
      payment_session_id: order.data.payment_session_id,
      order_id: orderId,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    console.error('[create-order]', errorMessage);
    const cfError = error as { response?: { data?: { message?: string } } };
    return NextResponse.json(
      { success: false, message: cfError.response?.data?.message || 'Internal Server Error' },
      { status: 500 },
    );
  }
}
