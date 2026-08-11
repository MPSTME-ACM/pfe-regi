import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tracks } from '@/lib/db/schema';
import { inArray } from 'drizzle-orm';
import { getSettings } from '@/lib/settings';
import { resolvePrice, REJECTION_MESSAGES, type Sku } from '@/lib/pricing/resolvePrice';
import { findCoupon, couponUsage } from '@/lib/registration/coupons';
import { CAPSTONE_SLUG, resolveSelection, SKUS } from '@/lib/registration/capacity';

// ─────────────────────────────────────────────────────────────────────────────
// Price a selection without creating anything.
//
// The form needs to show what a coupon does BEFORE the buyer commits, and the
// only other endpoint that can price an order is `create-order` — which inserts
// a `pending` row and holds a seat for PENDING_HOLD_MINUTES. Quoting through it
// would burn a seat every time somebody typed a character into the code box.
//
// So: same settings, same resolveSelection, same resolvePrice, no writes and no
// row locks. Read-only by construction.
//
// THIS IS ADVISORY. `create-order` recomputes the amount inside the capacity
// transaction with the coupon row locked, and that number is the one charged. A
// code can be exhausted between a quote and a checkout; when that happens the
// checkout rejects it rather than honouring this preview. The two agreeing is
// the normal case, not a guarantee — which is exactly why the client is never
// allowed to send an amount.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic';

interface Body {
  sku?: string;
  beginnerTrack?: string | null;
  advancedTrack?: string | null;
  couponCode?: string | null;
  /** Optional. Only used to evaluate a per-person redemption limit. */
  email?: string | null;
  contact?: string | null;
}

function bad(message: string, error: string, status = 400) {
  return NextResponse.json({ success: false, message, error }, { status });
}

export async function POST(request: Request) {
  try {
    // Gated for the same reason create-order is: leaving this open would let
    // anyone enumerate valid coupon codes against a closed form.
    const settings = await getSettings();
    if (!settings.registrationOpen) {
      return bad('Registration is currently closed.', 'REGISTRATION_CLOSED', 403);
    }

    const body = (await request.json()) as Body;

    if (!body.sku || !SKUS.includes(body.sku as Sku)) {
      return bad('Choose what you want to register for.', 'INVALID_INPUT');
    }

    const wanted = [body.beginnerTrack, body.advancedTrack, CAPSTONE_SLUG].filter(
      (s): s is string => typeof s === 'string' && s.length > 0,
    );
    const found = await db.select().from(tracks).where(inArray(tracks.slug, wanted));
    const bySlug = new Map(found.map((t) => [t.slug, t]));

    // The price depends on the SKU alone, but this still runs so that an
    // incoherent selection (a bundle missing a track, say) is reported here
    // rather than quoting a price for something that cannot be bought.
    const selection = resolveSelection(
      body.sku as Sku,
      body.beginnerTrack ?? undefined,
      body.advancedTrack ?? undefined,
      bySlug,
    );
    if (typeof selection === 'string') return bad(selection, 'INVALID_SELECTION');

    const rawCode = body.couponCode?.trim() || '';
    const coupon = rawCode ? await findCoupon(db, rawCode) : null;
    if (rawCode && !coupon) {
      return bad('That code is not valid.', 'COUPON_INVALID');
    }

    // Without an email/contact the per-person counter reads zero, so a code
    // capped per person quotes as applicable even for someone who has already
    // used it. The form sends both once they are filled in; checkout always has
    // them and is where that limit is actually enforced.
    let usage = { total: 0, byPerson: 0 };
    if (coupon) {
      usage = await couponUsage(
        db,
        coupon.id,
        body.email?.trim() || '',
        body.contact?.trim() || '',
      );
    }

    const price = resolvePrice({
      sku: selection.sku,
      prices: {
        capstone: settings.priceCapstone,
        single: settings.priceSingle,
        bundle: settings.priceBundle,
      },
      coupon,
      couponUses: usage.total,
      couponUsesByPerson: usage.byPerson,
      now: new Date(),
    });

    return NextResponse.json({
      success: true,
      base: price.base,
      discount: price.discount,
      amount: price.amount,
      couponApplied: price.couponApplied,
      rejection: price.rejection,
      // Same strings the checkout would return, so a code rejected here and a
      // code rejected at payment never explain themselves differently.
      message: price.rejection ? REJECTION_MESSAGES[price.rejection] : null,
    });
  } catch (error) {
    console.error('[quote] failed:', error);
    return NextResponse.json(
      { success: false, message: 'Could not check that code right now.', error: 'INTERNAL' },
      { status: 500 },
    );
  }
}
