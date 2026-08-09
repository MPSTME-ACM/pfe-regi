'use client';

import React from 'react';
import type { Sku } from '@/lib/pricing/resolvePrice';

// The single most important choice on the page, so it is three real radio
// inputs in a fieldset rather than a <select>: every option is visible at once,
// arrow keys move between them, and the price of each is legible without
// interacting. The inputs are `sr-only` and the card is the label, so the native
// semantics survive intact while the card carries the styling.

/**
 * Display order, and it is deliberate.
 *
 * Cheapest-first put the capstone day — the narrowest option — in the position
 * people read first. This runs entry (One Track) → the one we want chosen (Full
 * Bundle, badged "Best value", sitting in the middle where the eye lands on a
 * three-up row) → the add-on day last.
 *
 * Only the rendering below depends on this order. `SKUS.includes(...)` in
 * RegistrationForm validates a restored draft and does not care.
 */
export const SKUS: Sku[] = ['single', 'bundle', 'capstone'];

const COPY: Record<Sku, { title: string; when: string; blurb: string; badge?: string }> = {
  single: {
    title: 'One Track',
    when: 'Both of its days',
    blurb: 'Pick any single beginner or advanced track and attend it end to end.',
  },
  bundle: {
    title: 'Full Bundle',
    when: 'All 5 days',
    blurb: 'One beginner track, one advanced track, and the capstone day included.',
    badge: 'Best value',
  },
  capstone: {
    title: 'Capstone Day',
    when: '23 Sept',
    blurb: 'Git & GitHub, building a portfolio, and shipping it on GitHub Pages.',
  }
};

export default function SkuChooser({
  value,
  priceLabels,
  onChange,
}: {
  value: Sku | '';
  priceLabels: Record<Sku, string>;
  onChange: (sku: Sku) => void;
}) {
  return (
    <fieldset className="mb-8">
      <legend className="mb-3 block text-sm font-medium text-gray-300">
        What are you registering for? <span className="text-[#e97bfc]">*</span>
      </legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {SKUS.map((sku) => {
          const { title, when, blurb, badge } = COPY[sku];
          const selected = value === sku;
          return (
            <label
              key={sku}
              className={[
                'relative flex cursor-pointer flex-col rounded-xl border p-4 transition-colors duration-200',
                'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[#f8c8fc]',
                selected
                  ? 'border-[#e97bfc] bg-[#e97bfc]/10 ring-1 ring-[#e97bfc]'
                  : 'border-white/20 bg-white/5 hover:border-white/40 hover:bg-white/10',
              ].join(' ')}
            >
              <input
                type="radio"
                name="sku"
                value={sku}
                checked={selected}
                onChange={() => onChange(sku)}
                required
                // Transparent but full-size and stacked over the card, rather
                // than `sr-only`: the whole card is then the radio's own hit
                // area, so a tap anywhere on it lands on the input itself and
                // not on a label that has to forward the click.
                className="absolute inset-0 h-full w-full cursor-pointer appearance-none rounded-xl opacity-0 focus:outline-none"
              />
              <span className="flex items-baseline justify-between gap-2">
                <span className="font-semibold text-[#f8c8fc]">{title}</span>
                <span className="text-lg font-bold whitespace-nowrap text-white">
                  {priceLabels[sku]}
                </span>
              </span>
              <span className="mt-0.5 text-xs text-gray-400">{when}</span>
              <span className="mt-2 text-xs leading-relaxed text-gray-500">{blurb}</span>
              {badge && (
                <span className="mt-3 self-start rounded-full bg-[#e97bfc]/20 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-[#f8c8fc] uppercase">
                  {badge}
                </span>
              )}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
