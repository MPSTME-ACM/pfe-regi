'use client';

import React from 'react';
import OptionCard from './OptionCard';
import type { Sku } from '@/lib/pricing/resolvePrice';

// The single most important choice on the page, so it is three real radio
// inputs in a fieldset rather than a <select>: every option is visible at once,
// arrow keys move between them, and the price of each is legible without
// interacting. The card markup itself lives in OptionCard, shared with the track
// pickers below so the two controls cannot drift apart.

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
        What are you registering for? <span className="text-accent">*</span>
      </legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {SKUS.map((sku) => {
          const { title, when, blurb, badge } = COPY[sku];
          return (
            <OptionCard
              key={sku}
              name="sku"
              value={sku}
              checked={value === sku}
              onSelect={(v) => onChange(v as Sku)}
              title={title}
              trailing={priceLabels[sku]}
              when={when}
              blurb={blurb}
              badge={badge}
              required
            />
          );
        })}
      </div>
    </fieldset>
  );
}
