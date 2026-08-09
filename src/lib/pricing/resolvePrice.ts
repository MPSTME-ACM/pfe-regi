// ─────────────────────────────────────────────────────────────────────────────
// The single source of truth for what an order costs.
//
// Pure: no database, no clock, no I/O. `now` is injected so validity windows are
// testable. This is deliberate — it is the one place where being wrong charges a
// real student the wrong amount, so it has to be exhaustively testable without a
// running Postgres.
//
// EVERY AMOUNT IS INTEGER PAISE. ₹250 is 25000. There are no floats anywhere in
// this file, and there must never be: 0.1 + 0.2 is not 0.3, and money that is
// off by a paisa is a reconciliation problem nobody wants at 2am.
//
// The client never sends a price. It sends { sku, tracks, couponCode }; the
// server calls this and stores the result in registrations.amountPaid.
// ─────────────────────────────────────────────────────────────────────────────

/** Must stay in sync with `skuEnum` in src/lib/db/schema.ts. */
export type Sku = 'capstone' | 'single' | 'bundle';

export type CouponType = 'percent' | 'flat' | 'fixed' | 'free';

export interface Coupon {
  id: number;
  /** Stored and compared uppercase and trimmed. See `normaliseCode`. */
  code: string;
  type: CouponType;
  /**
   * `percent` → 0..100.
   * `flat`    → paise to subtract.
   * `fixed`   → the final price in paise, replacing the base.
   * `free`    → ignored; the order becomes 0.
   */
  value: number;
  /** Which SKUs this is valid for. Empty array means all of them. */
  appliesTo: Sku[];
  /** Minimum order value in paise before any discount. Null means no minimum. */
  minAmount: number | null;
  /** Total redemptions allowed across everyone. Null means unlimited. */
  maxUses: number | null;
  /** Redemptions allowed per person. Null means unlimited. */
  maxPerPerson: number | null;
  validFrom: Date | null;
  validUntil: Date | null;
  enabled: boolean;
}

export type CouponRejection =
  | 'DISABLED'
  | 'NOT_YET_VALID'
  | 'EXPIRED'
  | 'SKU_NOT_ELIGIBLE'
  | 'MIN_AMOUNT_NOT_MET'
  | 'MAX_USES_REACHED'
  | 'MAX_PER_PERSON_REACHED';

/** Human-readable reasons. The API hands these straight to the form. */
export const REJECTION_MESSAGES: Record<CouponRejection, string> = {
  DISABLED: 'This code is no longer active.',
  NOT_YET_VALID: 'This code is not valid yet.',
  EXPIRED: 'This code has expired.',
  SKU_NOT_ELIGIBLE: 'This code does not apply to the option you selected.',
  MIN_AMOUNT_NOT_MET: 'This code requires a larger order.',
  MAX_USES_REACHED: 'This code has already been fully redeemed.',
  MAX_PER_PERSON_REACHED: 'You have already used this code.',
};

export interface Prices {
  /** All in paise. Comes from the `settings` singleton. */
  capstone: number;
  single: number;
  bundle: number;
}

export interface PriceInput {
  sku: Sku;
  prices: Prices;
  /** Null when no code was entered, or when the entered code did not exist. */
  coupon?: Coupon | null;
  /** Redemptions of this coupon already burned across everyone. */
  couponUses?: number;
  /** Redemptions of this coupon already burned by this person. */
  couponUsesByPerson?: number;
  now: Date;
}

export interface PriceResult {
  /** Undiscounted price of the chosen SKU, in paise. */
  base: number;
  /** Paise removed. Never exceeds `base`. */
  discount: number;
  /** What to charge, in paise. Always an integer, always >= 0. */
  amount: number;
  couponApplied: boolean;
  /** Why the coupon did not apply. Null when it did, or when none was supplied. */
  rejection: CouponRejection | null;
}

/**
 * Codes are read off a screen and typed by hand, so compare them forgivingly.
 * Bulk generation also excludes ambiguous characters — see the phase 3 generator.
 */
export function normaliseCode(code: string): string {
  return code.trim().toUpperCase();
}

function basePriceFor(sku: Sku, prices: Prices): number {
  switch (sku) {
    case 'capstone':
      return prices.capstone;
    case 'single':
      return prices.single;
    case 'bundle':
      return prices.bundle;
  }
}

/**
 * Why the coupon cannot be used, or null if it can.
 *
 * Order matters for the message the user sees. Identity of the code comes first
 * (disabled, expired), then eligibility (SKU, minimum), then exhaustion (uses).
 * A user whose code is simply expired should be told that, not that someone else
 * used up the last redemption.
 */
function rejectionFor(
  coupon: Coupon,
  base: number,
  input: PriceInput,
): CouponRejection | null {
  if (!coupon.enabled) return 'DISABLED';

  const now = input.now.getTime();
  if (coupon.validFrom && now < coupon.validFrom.getTime()) return 'NOT_YET_VALID';
  // Inclusive of the instant itself: a coupon valid until 23:59:59 works at
  // exactly 23:59:59.
  if (coupon.validUntil && now > coupon.validUntil.getTime()) return 'EXPIRED';

  // Empty appliesTo means "every SKU", not "no SKU".
  if (coupon.appliesTo.length > 0 && !coupon.appliesTo.includes(input.sku)) {
    return 'SKU_NOT_ELIGIBLE';
  }

  // Compared against the pre-discount price. No stacking exists, so there is no
  // ambiguity about which order value this refers to.
  if (coupon.minAmount !== null && base < coupon.minAmount) return 'MIN_AMOUNT_NOT_MET';

  if (coupon.maxUses !== null && (input.couponUses ?? 0) >= coupon.maxUses) {
    return 'MAX_USES_REACHED';
  }
  if (coupon.maxPerPerson !== null && (input.couponUsesByPerson ?? 0) >= coupon.maxPerPerson) {
    return 'MAX_PER_PERSON_REACHED';
  }

  return null;
}

/**
 * Discount in paise for an eligible coupon. Always clamped to [0, base] — a
 * coupon can make an order free but can never make it negative, and can never
 * turn into a refund.
 */
function discountFor(coupon: Coupon, base: number): number {
  switch (coupon.type) {
    case 'free':
      return base;

    case 'percent': {
      // Clamp the percentage itself: a mis-entered 150% must not owe money back.
      const pct = Math.min(100, Math.max(0, coupon.value));
      // Round rather than floor so 50% of an odd number splits predictably
      // instead of always favouring one side.
      return Math.min(base, Math.round((base * pct) / 100));
    }

    case 'flat':
      return Math.min(base, Math.max(0, coupon.value));

    case 'fixed': {
      // `value` is the resulting price, not the reduction. A "fixed ₹99" coupon
      // on a cheaper SKU must not silently become a discount of zero-minus.
      const target = Math.min(base, Math.max(0, coupon.value));
      return base - target;
    }
  }
}

export function resolvePrice(input: PriceInput): PriceResult {
  const base = basePriceFor(input.sku, input.prices);

  if (!input.coupon) {
    return { base, discount: 0, amount: base, couponApplied: false, rejection: null };
  }

  const rejection = rejectionFor(input.coupon, base, input);
  if (rejection) {
    return { base, discount: 0, amount: base, couponApplied: false, rejection };
  }

  const discount = discountFor(input.coupon, base);
  return {
    base,
    discount,
    amount: base - discount,
    couponApplied: true,
    rejection: null,
  };
}
