'use client';

import { useState } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// The coupon box.
//
// Explicit Apply rather than validate-as-you-type: every check is a database
// round trip that reads the redemption table, and revalidating on each keystroke
// would hammer it for no benefit. It also makes "did my code work?" answerable —
// a field that silently revalidates leaves the buyer unsure whether the last
// thing they saw is still true.
//
// The applied state lives in the PARENT, not here, because two things depend on
// it that this component cannot see: the price line, and whether the submit
// button is allowed to fire. See `appliedCoupon` in RegistrationForm.
// ─────────────────────────────────────────────────────────────────────────────

/** ₹ formatting for the browser. `formatPaise` in lib/settings reaches lib/db,
 *  and importing it here would drag drizzle into the client bundle. */
export function formatPaiseClient(paise: number): string {
  const rupees = paise / 100;
  return `₹${Number.isInteger(rupees) ? rupees : rupees.toFixed(2)}`;
}

export interface AppliedCoupon {
  code: string;
  base: number;
  discount: number;
  amount: number;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'checking' }
  /** The code exists but cannot be used here, or is not a code at all. */
  | { kind: 'rejected'; message: string };

export default function CouponField({
  value,
  onChange,
  applied,
  onApplied,
  onCleared,
  /** Builds the request body. Null means the selection is not ready to price. */
  buildQuoteBody,
}: {
  value: string;
  onChange: (v: string) => void;
  applied: AppliedCoupon | null;
  onApplied: (a: AppliedCoupon) => void;
  onCleared: () => void;
  buildQuoteBody: () => Record<string, string> | null;
}) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const apply = async () => {
    const code = value.trim();
    if (!code) return;

    const body = buildQuoteBody();
    if (!body) {
      setStatus({ kind: 'rejected', message: 'Choose your ticket and track first.' });
      return;
    }

    setStatus({ kind: 'checking' });
    try {
      const res = await fetch('/api/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, couponCode: code }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        setStatus({ kind: 'rejected', message: data.message || 'That code is not valid.' });
        return;
      }
      if (!data.couponApplied) {
        // resolvePrice explains itself; do not invent a friendlier reason.
        setStatus({ kind: 'rejected', message: data.message || 'That code does not apply here.' });
        return;
      }

      setStatus({ kind: 'idle' });
      onApplied({ code, base: data.base, discount: data.discount, amount: data.amount });
    } catch {
      setStatus({ kind: 'rejected', message: 'Could not check that code. Check your connection.' });
    }
  };

  const remove = () => {
    onChange('');
    setStatus({ kind: 'idle' });
    onCleared();
  };

  if (applied) {
    return (
      <div className="mb-6 rounded-lg border border-accent/30 bg-accent/10 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-accent-soft">
            <span className="font-mono font-semibold">{applied.code}</span> applied — you save{' '}
            <span className="font-semibold">{formatPaiseClient(applied.discount)}</span>
          </p>
          <button
            type="button"
            onClick={remove}
            className="inline-flex min-h-11 items-center rounded-lg px-2 text-sm text-gray-300 underline underline-offset-4 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-soft sm:min-h-0"
          >
            Remove
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-6">
      <label htmlFor="couponCode" className="block text-sm font-medium text-gray-300 mb-2">
        Coupon code
      </label>
      <div className="flex gap-2">
        <input
          id="couponCode"
          name="couponCode"
          type="text"
          autoComplete="off"
          autoCapitalize="characters"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            if (status.kind === 'rejected') setStatus({ kind: 'idle' });
          }}
          // Enter inside a form submits it. This field is not the way to buy a
          // ticket, so it applies the code instead.
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void apply();
            }
          }}
          placeholder="Optional"
          aria-invalid={status.kind === 'rejected' ? true : undefined}
          aria-describedby={status.kind === 'rejected' ? 'couponCode-error' : undefined}
          className="w-full bg-white/5 border border-white/20 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-accent-soft transition-all duration-300"
        />
        <button
          type="button"
          onClick={apply}
          disabled={!value.trim() || status.kind === 'checking'}
          className="shrink-0 rounded-lg border border-hairline bg-white/[0.06] px-5 font-medium text-white transition-colors hover:bg-white/12 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-soft disabled:opacity-40"
        >
          {status.kind === 'checking' ? 'Checking…' : 'Apply'}
        </button>
      </div>
      <div aria-live="polite">
        {status.kind === 'rejected' && (
          <p id="couponCode-error" className="text-red-400 text-xs mt-1">
            {status.message}
          </p>
        )}
      </div>
    </div>
  );
}
