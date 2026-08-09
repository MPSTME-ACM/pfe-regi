// ─────────────────────────────────────────────────────────────────────────────
// Spec tests for the pricing resolver.
//
// These are written against the SPEC, not against the implementation: every
// expected value below is a hand-computed integer-paise literal, never a
// re-derivation of the formula under test. Recomputing `base - Math.round(base *
// pct / 100)` inside an assertion proves only that the test can run the same
// arithmetic twice.
//
// Prices are hardcoded fixtures rather than imported from @/lib/settings —
// that module opens a pg Pool at import time, and this suite must stay pure.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';

import {
  normaliseCode,
  resolvePrice,
  type Coupon,
  type CouponType,
  type PriceResult,
  type Prices,
  type Sku,
} from '@/lib/pricing/resolvePrice';

/** The three SKU prices from the 2026 spec, in paise. */
const PRICES: Prices = {
  capstone: 10000,
  single: 25000,
  bundle: 50000,
};

/** A price list the admin has edited, used to prove base prices are not constants. */
const CUSTOM_PRICES: Prices = {
  capstone: 4990,
  single: 19900,
  bundle: 34990,
};

const NOW = new Date('2026-08-01T12:00:00.000Z');

/**
 * A coupon with every gate wide open. Each test overrides only the one field it
 * is about, so a case that says `{ type: 'flat', value: 7500 }` is unambiguously
 * about flat discounts and nothing else.
 */
function coupon(overrides: Partial<Coupon> = {}): Coupon {
  return {
    id: 1,
    code: 'TESTCODE',
    type: 'percent',
    value: 10,
    appliesTo: [],
    minAmount: null,
    maxUses: null,
    maxPerPerson: null,
    validFrom: null,
    validUntil: null,
    enabled: true,
    ...overrides,
  };
}

/** Asserts all five result fields at once — rejections leak through the ones you skip. */
function expectResult(actual: PriceResult, expected: PriceResult): void {
  expect(actual).toEqual(expected);
}

describe('resolvePrice — base price per SKU', () => {
  it('charges 10000 paise for capstone', () => {
    expectResult(resolvePrice({ sku: 'capstone', prices: PRICES, now: NOW }), {
      base: 10000,
      discount: 0,
      amount: 10000,
      couponApplied: false,
      rejection: null,
    });
  });

  it('charges 25000 paise for single', () => {
    expectResult(resolvePrice({ sku: 'single', prices: PRICES, now: NOW }), {
      base: 25000,
      discount: 0,
      amount: 25000,
      couponApplied: false,
      rejection: null,
    });
  });

  it('charges 50000 paise for bundle', () => {
    expectResult(resolvePrice({ sku: 'bundle', prices: PRICES, now: NOW }), {
      base: 50000,
      discount: 0,
      amount: 50000,
      couponApplied: false,
      rejection: null,
    });
  });

  it('reads the base price from the settings it is handed, not from a constant', () => {
    expect(resolvePrice({ sku: 'capstone', prices: CUSTOM_PRICES, now: NOW }).amount).toBe(4990);
    expect(resolvePrice({ sku: 'single', prices: CUSTOM_PRICES, now: NOW }).amount).toBe(19900);
    expect(resolvePrice({ sku: 'bundle', prices: CUSTOM_PRICES, now: NOW }).amount).toBe(34990);
  });

  it('treats an explicit null coupon exactly like no coupon at all', () => {
    expectResult(resolvePrice({ sku: 'bundle', prices: PRICES, coupon: null, now: NOW }), {
      base: 50000,
      discount: 0,
      amount: 50000,
      couponApplied: false,
      rejection: null,
    });
  });
});

describe('resolvePrice — coupon types against every SKU', () => {
  // Hand-computed paise. 20% off / 7500 off / a fixed 9900 final price / free.
  const cases: Array<{
    type: CouponType;
    value: number;
    sku: Sku;
    base: number;
    discount: number;
    amount: number;
  }> = [
    { type: 'percent', value: 20, sku: 'capstone', base: 10000, discount: 2000, amount: 8000 },
    { type: 'percent', value: 20, sku: 'single', base: 25000, discount: 5000, amount: 20000 },
    { type: 'percent', value: 20, sku: 'bundle', base: 50000, discount: 10000, amount: 40000 },

    { type: 'flat', value: 7500, sku: 'capstone', base: 10000, discount: 7500, amount: 2500 },
    { type: 'flat', value: 7500, sku: 'single', base: 25000, discount: 7500, amount: 17500 },
    { type: 'flat', value: 7500, sku: 'bundle', base: 50000, discount: 7500, amount: 42500 },

    { type: 'fixed', value: 9900, sku: 'capstone', base: 10000, discount: 100, amount: 9900 },
    { type: 'fixed', value: 9900, sku: 'single', base: 25000, discount: 15100, amount: 9900 },
    { type: 'fixed', value: 9900, sku: 'bundle', base: 50000, discount: 40100, amount: 9900 },

    { type: 'free', value: 0, sku: 'capstone', base: 10000, discount: 10000, amount: 0 },
    { type: 'free', value: 0, sku: 'single', base: 25000, discount: 25000, amount: 0 },
    { type: 'free', value: 0, sku: 'bundle', base: 50000, discount: 50000, amount: 0 },
  ];

  it.each(cases)(
    '$type coupon (value $value) on $sku charges $amount paise',
    ({ type, value, sku, base, discount, amount }) => {
      expectResult(
        resolvePrice({ sku, prices: PRICES, coupon: coupon({ type, value }), now: NOW }),
        { base, discount, amount, couponApplied: true, rejection: null },
      );
    },
  );

  it('makes a free coupon cost exactly zero, not near-zero', () => {
    const result = resolvePrice({
      sku: 'bundle',
      prices: CUSTOM_PRICES,
      coupon: coupon({ type: 'free', value: 12345 }),
      now: NOW,
    });
    expect(result.amount).toBe(0);
    expect(Number.isInteger(result.amount)).toBe(true);
  });
});

describe('resolvePrice — percent arithmetic stays in whole paise', () => {
  it('rounds 33% of 4990 to 1647 paise', () => {
    // 4990 * 33 / 100 = 1646.7
    expectResult(
      resolvePrice({
        sku: 'capstone',
        prices: CUSTOM_PRICES,
        coupon: coupon({ type: 'percent', value: 33 }),
        now: NOW,
      }),
      { base: 4990, discount: 1647, amount: 3343, couponApplied: true, rejection: null },
    );
  });

  it('rounds a half-paisa discount up: 15% of 4990 is 749 paise', () => {
    // 4990 * 15 / 100 = 748.5
    expectResult(
      resolvePrice({
        sku: 'capstone',
        prices: CUSTOM_PRICES,
        coupon: coupon({ type: 'percent', value: 15 }),
        now: NOW,
      }),
      { base: 4990, discount: 749, amount: 4241, couponApplied: true, rejection: null },
    );
  });

  it('applies a 0% coupon with no discount rather than rejecting it', () => {
    expectResult(
      resolvePrice({
        sku: 'single',
        prices: PRICES,
        coupon: coupon({ type: 'percent', value: 0 }),
        now: NOW,
      }),
      { base: 25000, discount: 0, amount: 25000, couponApplied: true, rejection: null },
    );
  });

  it('charges nothing for a 100% coupon', () => {
    expectResult(
      resolvePrice({
        sku: 'bundle',
        prices: PRICES,
        coupon: coupon({ type: 'percent', value: 100 }),
        now: NOW,
      }),
      { base: 50000, discount: 50000, amount: 0, couponApplied: true, rejection: null },
    );
  });
});

describe('resolvePrice — the order can never go negative', () => {
  it('floors a flat discount larger than the base at zero', () => {
    expectResult(
      resolvePrice({
        sku: 'capstone',
        prices: PRICES,
        coupon: coupon({ type: 'flat', value: 999999 }),
        now: NOW,
      }),
      { base: 10000, discount: 10000, amount: 0, couponApplied: true, rejection: null },
    );
  });

  it('clamps a mis-entered 150% coupon to a free order, not a refund', () => {
    expectResult(
      resolvePrice({
        sku: 'single',
        prices: PRICES,
        coupon: coupon({ type: 'percent', value: 150 }),
        now: NOW,
      }),
      { base: 25000, discount: 25000, amount: 0, couponApplied: true, rejection: null },
    );
  });

  it('ignores a negative percent instead of adding to the price', () => {
    expectResult(
      resolvePrice({
        sku: 'single',
        prices: PRICES,
        coupon: coupon({ type: 'percent', value: -25 }),
        now: NOW,
      }),
      { base: 25000, discount: 0, amount: 25000, couponApplied: true, rejection: null },
    );
  });

  it('ignores a negative flat value instead of adding to the price', () => {
    expectResult(
      resolvePrice({
        sku: 'single',
        prices: PRICES,
        coupon: coupon({ type: 'flat', value: -5000 }),
        now: NOW,
      }),
      { base: 25000, discount: 0, amount: 25000, couponApplied: true, rejection: null },
    );
  });

  it('never charges more than the base when a fixed price exceeds it', () => {
    expectResult(
      resolvePrice({
        sku: 'capstone',
        prices: PRICES,
        coupon: coupon({ type: 'fixed', value: 90000 }),
        now: NOW,
      }),
      { base: 10000, discount: 0, amount: 10000, couponApplied: true, rejection: null },
    );
  });

  it('treats a fixed price of 0 as a free order', () => {
    expectResult(
      resolvePrice({
        sku: 'bundle',
        prices: PRICES,
        coupon: coupon({ type: 'fixed', value: 0 }),
        now: NOW,
      }),
      { base: 50000, discount: 50000, amount: 0, couponApplied: true, rejection: null },
    );
  });

  it('clamps a negative fixed price to a free order', () => {
    expectResult(
      resolvePrice({
        sku: 'bundle',
        prices: PRICES,
        coupon: coupon({ type: 'fixed', value: -1 }),
        now: NOW,
      }),
      { base: 50000, discount: 50000, amount: 0, couponApplied: true, rejection: null },
    );
  });
});

describe('resolvePrice — SKU eligibility', () => {
  it('rejects a coupon whose appliesTo excludes the chosen SKU', () => {
    expectResult(
      resolvePrice({
        sku: 'single',
        prices: PRICES,
        coupon: coupon({ type: 'flat', value: 5000, appliesTo: ['bundle', 'capstone'] }),
        now: NOW,
      }),
      {
        base: 25000,
        discount: 0,
        amount: 25000,
        couponApplied: false,
        rejection: 'SKU_NOT_ELIGIBLE',
      },
    );
  });

  it('accepts a coupon whose appliesTo includes the chosen SKU', () => {
    expectResult(
      resolvePrice({
        sku: 'bundle',
        prices: PRICES,
        coupon: coupon({ type: 'flat', value: 5000, appliesTo: ['bundle', 'capstone'] }),
        now: NOW,
      }),
      { base: 50000, discount: 5000, amount: 45000, couponApplied: true, rejection: null },
    );
  });

  it('treats an empty appliesTo as every SKU, not as no SKU', () => {
    for (const sku of ['capstone', 'single', 'bundle'] as const) {
      const result = resolvePrice({
        sku,
        prices: PRICES,
        coupon: coupon({ type: 'flat', value: 1000, appliesTo: [] }),
        now: NOW,
      });
      expect(result.couponApplied).toBe(true);
      expect(result.rejection).toBeNull();
      expect(result.discount).toBe(1000);
    }
  });
});

describe('resolvePrice — minimum order value', () => {
  it('rejects when the base is below minAmount', () => {
    expectResult(
      resolvePrice({
        sku: 'single',
        prices: PRICES,
        coupon: coupon({ type: 'flat', value: 5000, minAmount: 30000 }),
        now: NOW,
      }),
      {
        base: 25000,
        discount: 0,
        amount: 25000,
        couponApplied: false,
        rejection: 'MIN_AMOUNT_NOT_MET',
      },
    );
  });

  it('accepts when the base equals minAmount exactly', () => {
    expectResult(
      resolvePrice({
        sku: 'single',
        prices: PRICES,
        coupon: coupon({ type: 'flat', value: 5000, minAmount: 25000 }),
        now: NOW,
      }),
      { base: 25000, discount: 5000, amount: 20000, couponApplied: true, rejection: null },
    );
  });

  it('compares minAmount against the pre-discount base, not the discounted amount', () => {
    // A 90% coupon would take 50000 down to 5000; the 40000 minimum still passes
    // because it is measured against the base.
    expectResult(
      resolvePrice({
        sku: 'bundle',
        prices: PRICES,
        coupon: coupon({ type: 'percent', value: 90, minAmount: 40000 }),
        now: NOW,
      }),
      { base: 50000, discount: 45000, amount: 5000, couponApplied: true, rejection: null },
    );
  });

  it('applies a null-minAmount coupon to the cheapest SKU', () => {
    expect(
      resolvePrice({
        sku: 'capstone',
        prices: PRICES,
        coupon: coupon({ type: 'flat', value: 2000, minAmount: null }),
        now: NOW,
      }).amount,
    ).toBe(8000);
  });
});

describe('resolvePrice — validity window', () => {
  const validFrom = new Date('2026-09-01T00:00:00.000Z');
  const validUntil = new Date('2026-09-23T23:59:59.000Z');

  it('rejects with NOT_YET_VALID before validFrom', () => {
    expectResult(
      resolvePrice({
        sku: 'bundle',
        prices: PRICES,
        coupon: coupon({ type: 'flat', value: 5000, validFrom }),
        now: new Date('2026-08-31T23:59:59.000Z'),
      }),
      {
        base: 50000,
        discount: 0,
        amount: 50000,
        couponApplied: false,
        rejection: 'NOT_YET_VALID',
      },
    );
  });

  it('accepts at exactly validFrom', () => {
    expectResult(
      resolvePrice({
        sku: 'bundle',
        prices: PRICES,
        coupon: coupon({ type: 'flat', value: 5000, validFrom }),
        now: new Date(validFrom.getTime()),
      }),
      { base: 50000, discount: 5000, amount: 45000, couponApplied: true, rejection: null },
    );
  });

  it('rejects with EXPIRED after validUntil', () => {
    expectResult(
      resolvePrice({
        sku: 'bundle',
        prices: PRICES,
        coupon: coupon({ type: 'flat', value: 5000, validUntil }),
        now: new Date('2026-09-24T00:00:00.000Z'),
      }),
      { base: 50000, discount: 0, amount: 50000, couponApplied: false, rejection: 'EXPIRED' },
    );
  });

  it('accepts at exactly validUntil — the window is inclusive of the instant', () => {
    expectResult(
      resolvePrice({
        sku: 'bundle',
        prices: PRICES,
        coupon: coupon({ type: 'flat', value: 5000, validUntil }),
        now: new Date(validUntil.getTime()),
      }),
      { base: 50000, discount: 5000, amount: 45000, couponApplied: true, rejection: null },
    );
  });

  it('accepts inside a two-sided window', () => {
    expect(
      resolvePrice({
        sku: 'single',
        prices: PRICES,
        coupon: coupon({ type: 'percent', value: 20, validFrom, validUntil }),
        now: new Date('2026-09-10T09:00:00.000Z'),
      }).amount,
    ).toBe(20000);
  });

  it('ignores both bounds when they are null', () => {
    expect(
      resolvePrice({
        sku: 'single',
        prices: PRICES,
        coupon: coupon({ type: 'percent', value: 20, validFrom: null, validUntil: null }),
        now: new Date('1999-01-01T00:00:00.000Z'),
      }).amount,
    ).toBe(20000);
  });
});

describe('resolvePrice — enabled flag', () => {
  it('rejects a disabled coupon', () => {
    expectResult(
      resolvePrice({
        sku: 'capstone',
        prices: PRICES,
        coupon: coupon({ type: 'free', enabled: false }),
        now: NOW,
      }),
      { base: 10000, discount: 0, amount: 10000, couponApplied: false, rejection: 'DISABLED' },
    );
  });
});

describe('resolvePrice — redemption limits', () => {
  it('rejects once total uses have reached maxUses', () => {
    expectResult(
      resolvePrice({
        sku: 'bundle',
        prices: PRICES,
        coupon: coupon({ type: 'flat', value: 5000, maxUses: 50 }),
        couponUses: 50,
        now: NOW,
      }),
      {
        base: 50000,
        discount: 0,
        amount: 50000,
        couponApplied: false,
        rejection: 'MAX_USES_REACHED',
      },
    );
  });

  it('accepts on the final available redemption', () => {
    expectResult(
      resolvePrice({
        sku: 'bundle',
        prices: PRICES,
        coupon: coupon({ type: 'flat', value: 5000, maxUses: 50 }),
        couponUses: 49,
        now: NOW,
      }),
      { base: 50000, discount: 5000, amount: 45000, couponApplied: true, rejection: null },
    );
  });

  it('rejects once this person has reached maxPerPerson', () => {
    expectResult(
      resolvePrice({
        sku: 'single',
        prices: PRICES,
        coupon: coupon({ type: 'percent', value: 50, maxPerPerson: 1 }),
        couponUses: 3,
        couponUsesByPerson: 1,
        now: NOW,
      }),
      {
        base: 25000,
        discount: 0,
        amount: 25000,
        couponApplied: false,
        rejection: 'MAX_PER_PERSON_REACHED',
      },
    );
  });

  it('accepts a person who is under their per-person limit', () => {
    expectResult(
      resolvePrice({
        sku: 'single',
        prices: PRICES,
        coupon: coupon({ type: 'percent', value: 50, maxPerPerson: 2 }),
        couponUses: 3,
        couponUsesByPerson: 1,
        now: NOW,
      }),
      { base: 25000, discount: 12500, amount: 12500, couponApplied: true, rejection: null },
    );
  });

  it('treats omitted use counts as zero rather than as unlimited use', () => {
    expectResult(
      resolvePrice({
        sku: 'single',
        prices: PRICES,
        coupon: coupon({ type: 'flat', value: 5000, maxUses: 1, maxPerPerson: 1 }),
        now: NOW,
      }),
      { base: 25000, discount: 5000, amount: 20000, couponApplied: true, rejection: null },
    );
  });

  it('ignores use counts entirely when both limits are null', () => {
    expect(
      resolvePrice({
        sku: 'single',
        prices: PRICES,
        coupon: coupon({ type: 'flat', value: 5000, maxUses: null, maxPerPerson: null }),
        couponUses: 9999,
        couponUsesByPerson: 9999,
        now: NOW,
      }).amount,
    ).toBe(20000);
  });
});

describe('resolvePrice — rejection precedence', () => {
  it('reports DISABLED ahead of every other problem', () => {
    expect(
      resolvePrice({
        sku: 'single',
        prices: PRICES,
        coupon: coupon({
          enabled: false,
          appliesTo: ['bundle'],
          minAmount: 99999,
          maxUses: 1,
          validUntil: new Date('2020-01-01T00:00:00.000Z'),
        }),
        couponUses: 5,
        now: NOW,
      }).rejection,
    ).toBe('DISABLED');
  });

  it('reports EXPIRED ahead of SKU and exhaustion problems', () => {
    expect(
      resolvePrice({
        sku: 'single',
        prices: PRICES,
        coupon: coupon({
          appliesTo: ['bundle'],
          maxUses: 1,
          validUntil: new Date('2020-01-01T00:00:00.000Z'),
        }),
        couponUses: 5,
        now: NOW,
      }).rejection,
    ).toBe('EXPIRED');
  });

  it('reports SKU_NOT_ELIGIBLE ahead of the minimum and the use counts', () => {
    expect(
      resolvePrice({
        sku: 'single',
        prices: PRICES,
        coupon: coupon({ appliesTo: ['bundle'], minAmount: 99999, maxUses: 1 }),
        couponUses: 5,
        now: NOW,
      }).rejection,
    ).toBe('SKU_NOT_ELIGIBLE');
  });

  it('reports MIN_AMOUNT_NOT_MET ahead of the use counts', () => {
    expect(
      resolvePrice({
        sku: 'single',
        prices: PRICES,
        coupon: coupon({ minAmount: 99999, maxUses: 1, maxPerPerson: 1 }),
        couponUses: 5,
        couponUsesByPerson: 5,
        now: NOW,
      }).rejection,
    ).toBe('MIN_AMOUNT_NOT_MET');
  });

  it('reports MAX_USES_REACHED ahead of the per-person count', () => {
    expect(
      resolvePrice({
        sku: 'single',
        prices: PRICES,
        coupon: coupon({ maxUses: 1, maxPerPerson: 1 }),
        couponUses: 5,
        couponUsesByPerson: 5,
        now: NOW,
      }).rejection,
    ).toBe('MAX_USES_REACHED');
  });
});

describe('normaliseCode — how a typed code finds its coupon', () => {
  // resolvePrice takes an already-looked-up coupon, so the lookup is modelled the
  // way the API does it: normalise what was typed, then index the code bank.
  const BANK: Record<string, Coupon> = {
    ACM2026: coupon({ id: 7, code: 'ACM2026', type: 'flat', value: 5000 }),
  };

  function priceWithTypedCode(typed: string | null, sku: Sku): PriceResult {
    const found = typed === null ? null : (BANK[normaliseCode(typed)] ?? null);
    return resolvePrice({ sku, prices: PRICES, coupon: found, now: NOW });
  }

  it('uppercases a lowercase code', () => {
    expect(normaliseCode('acm2026')).toBe('ACM2026');
    expectResult(priceWithTypedCode('acm2026', 'single'), {
      base: 25000,
      discount: 5000,
      amount: 20000,
      couponApplied: true,
      rejection: null,
    });
  });

  it('trims leading and trailing whitespace', () => {
    expect(normaliseCode('   ACM2026  ')).toBe('ACM2026');
    expect(normaliseCode('\t ACM2026 \n')).toBe('ACM2026');
    expect(priceWithTypedCode('  acm2026 ', 'bundle').amount).toBe(45000);
  });

  it('leaves an already-normalised code untouched', () => {
    expect(normaliseCode('ACM2026')).toBe('ACM2026');
  });

  it('charges full price for an unknown code, with no rejection reason', () => {
    // An unknown code is indistinguishable from no code at this layer: the caller
    // surfaces "no such code" itself, since resolvePrice was handed nothing.
    expectResult(priceWithTypedCode('NOPE', 'capstone'), {
      base: 10000,
      discount: 0,
      amount: 10000,
      couponApplied: false,
      rejection: null,
    });
  });

  it('charges full price when no code was typed at all', () => {
    expectResult(priceWithTypedCode(null, 'bundle'), {
      base: 50000,
      discount: 0,
      amount: 50000,
      couponApplied: false,
      rejection: null,
    });
  });
});

describe('resolvePrice — every result is integer paise', () => {
  const samples: Coupon[] = [
    coupon({ type: 'percent', value: 33 }),
    coupon({ type: 'percent', value: 15 }),
    coupon({ type: 'flat', value: 7500 }),
    coupon({ type: 'fixed', value: 9900 }),
    coupon({ type: 'free', value: 0 }),
  ];

  it('never produces a fractional base, discount or amount', () => {
    for (const prices of [PRICES, CUSTOM_PRICES]) {
      for (const sku of ['capstone', 'single', 'bundle'] as const) {
        for (const c of samples) {
          const result = resolvePrice({ sku, prices, coupon: c, now: NOW });
          expect(Number.isInteger(result.base)).toBe(true);
          expect(Number.isInteger(result.discount)).toBe(true);
          expect(Number.isInteger(result.amount)).toBe(true);
          expect(result.amount).toBeGreaterThanOrEqual(0);
          expect(result.discount).toBeLessThanOrEqual(result.base);
          expect(result.base - result.discount).toBe(result.amount);
        }
      }
    }
  });
});
