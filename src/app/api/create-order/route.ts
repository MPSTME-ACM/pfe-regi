// app/api/create-order/route.ts
import { NextResponse } from 'next/server';
import { Cashfree, CFEnvironment } from 'cashfree-pg';
import { db } from '@/lib/db';
import { registrations, tracks, coupons } from '@/lib/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { getSettings, paiseToRupees } from '@/lib/settings';
import { resolvePrice, REJECTION_MESSAGES, type Sku } from '@/lib/pricing/resolvePrice';
import { findCoupon, findReferrerId, couponUsage, reserveCoupon } from '@/lib/registration/coupons';
import { generateOrderId } from '@/lib/registration/orderId';
import { siteUrl } from '@/lib/siteUrl';
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
  /** Free-text attribution, kept alongside the resolved referrerId. */
  referral?: string | null;
  /** One code per order. There is no stacking, by decision. */
  couponCode?: string | null;
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

    // Resolve the code before opening the transaction so an unknown one fails
    // fast, without holding row locks while we tell the user they typed it wrong.
    const rawCode = body.couponCode?.trim() || '';
    const coupon = rawCode ? await findCoupon(db, rawCode) : null;
    if (rawCode && !coupon) {
      return bad('That code is not valid.', 'COUPON_INVALID');
    }

    // Attribution only, and deliberately forgiving: an unknown or inactive
    // referrer code is ignored rather than rejected. A typo in an optional field
    // must never stop someone registering.
    const referrerId = await findReferrerId(body.referral);

    const prices = {
      capstone: settings.priceCapstone,
      single: settings.priceSingle,
      bundle: settings.priceBundle,
    };

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
        if (!current || !current.enabled) return { kind: 'full', name: t.name } as const;
        const used = t.slug === CAPSTONE_SLUG ? capstoneSold : (sold.get(t.id) ?? 0);
        if (used >= current.capacity) return { kind: 'full', name: current.name } as const;
      }

      // Lock the coupon row before counting its uses. Without this, two people
      // redeeming the same single-use code at once both read zero uses, both
      // pass, and both pay a discounted price. The track locks above do not
      // help — they may be buying different tracks entirely.
      let usage = { total: 0, byPerson: 0 };
      if (coupon) {
        await tx.select({ id: coupons.id }).from(coupons).where(eq(coupons.id, coupon.id)).for('update');
        usage = await couponUsage(tx, coupon.id, body.email!.trim(), body.contact!.trim());
      }

      // The ONLY place an amount is decided. The browser sent none and could
      // not have; whatever it displayed is cosmetic.
      const price = resolvePrice({
        sku: selection.sku,
        prices,
        coupon,
        couponUses: usage.total,
        couponUsesByPerson: usage.byPerson,
        now: new Date(),
      });

      // A code that exists but cannot be used here is an error, not a silent
      // downgrade to full price: someone who typed a code expects it to apply,
      // and quietly charging them more is how you get a chargeback.
      if (coupon && !price.couponApplied) {
        return { kind: 'coupon_rejected', rejection: price.rejection } as const;
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
        couponId: coupon?.id ?? null,
        referrerId,
      });

      if (coupon) {
        await reserveCoupon(tx, {
          couponId: coupon.id,
          orderId,
          email: body.email!.trim(),
          contact: body.contact!.trim(),
          amountOff: price.discount,
        });
      }

      return { kind: 'ok', amount: price.amount } as const;
    });

    if (outcome.kind === 'full') {
      return bad(`${outcome.name} is now full. Please choose another option.`, 'TRACK_FULL');
    }

    if (outcome.kind === 'coupon_rejected') {
      const reason = outcome.rejection
        ? REJECTION_MESSAGES[outcome.rejection]
        : 'That code cannot be used for this order.';
      return bad(reason, 'COUPON_REJECTED');
    }

    const amountPaid = outcome.amount;

    // A 100%-off coupon produces a zero order, and Cashfree cannot take one, so
    // it must never reach the gateway. completeWithoutPayment marks the row
    // 'comped', issues the QR and sends the ticket.
    if (amountPaid === 0) {
      await completeWithoutPayment(orderId);
      return NextResponse.json({ success: true, order_id: orderId, free: true });
    }

    // Not `|| 'http://localhost:3000'`. That fallback made a missing origin look
    // plausible instead of loud: Cashfree accepted the order, took the money, and
    // returned the student to localhost. siteUrl() throws instead.
    const baseUrl = siteUrl();
    const order = await cashfree.PGCreateOrder({
      order_id: orderId,
      order_amount: paiseToRupees(amountPaid),
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
