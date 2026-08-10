'use client';

import React from 'react';

// The selectable card used by both the SKU chooser and the track pickers.
//
// Extracted so the two are provably the same control rather than two components
// that merely look alike — the SKU cards and the track cards drifting apart is
// exactly the kind of thing nobody notices until it ships.
//
// It is a real radio in a real label: every option is visible at once, arrow
// keys move between them, and screen readers get the native semantics. The input
// is transparent and stretched over the whole card so a tap anywhere lands on
// the input itself rather than on a label that has to forward the click.

export type CardTone = 'accent' | 'suggested';

export default function OptionCard({
  name,
  value,
  checked,
  disabled = false,
  onSelect,
  title,
  trailing,
  when,
  blurb,
  badge,
  badgeTone = 'accent',
  required,
}: {
  name: string;
  value: string;
  checked: boolean;
  disabled?: boolean;
  onSelect: (value: string) => void;
  title: string;
  /** Right-aligned on the title row — a price, a seat count, anything short. */
  trailing?: React.ReactNode;
  when?: string;
  blurb?: string;
  badge?: string;
  badgeTone?: CardTone;
  required?: boolean;
}) {
  const state = disabled
    ? 'cursor-not-allowed border-white/10 bg-white/[0.02]'
    : checked
      ? 'cursor-pointer border-[#e97bfc] bg-[#e97bfc]/10 ring-1 ring-[#e97bfc]'
      : badge && badgeTone === 'suggested'
        // A suggestion is a nudge, not a selection: enough tint to draw the eye,
        // never enough to be mistaken for already-chosen.
        ? 'cursor-pointer border-[#f8c8fc]/40 bg-[#f8c8fc]/[0.06] hover:border-[#f8c8fc]/70 hover:bg-[#f8c8fc]/10'
        : 'cursor-pointer border-white/20 bg-white/5 hover:border-white/40 hover:bg-white/10';

  return (
    <label
      className={[
        'relative flex flex-col rounded-xl border p-4 transition-colors duration-200',
        'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[#f8c8fc]',
        state,
      ].join(' ')}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        required={required}
        onChange={() => onSelect(value)}
        className="absolute inset-0 h-full w-full cursor-[inherit] appearance-none rounded-xl opacity-0 focus:outline-none"
      />
      <span className="flex items-baseline justify-between gap-2">
        <span className={`font-semibold ${disabled ? 'text-gray-500' : 'text-[#f8c8fc]'}`}>
          {title}
        </span>
        {trailing && (
          <span className="text-lg font-bold whitespace-nowrap text-white">{trailing}</span>
        )}
      </span>
      {when && (
        <span className={`mt-0.5 text-xs ${disabled ? 'text-gray-600' : 'text-gray-400'}`}>
          {when}
        </span>
      )}
      {blurb && (
        <span className={`mt-2 text-xs leading-relaxed ${disabled ? 'text-gray-600' : 'text-gray-500'}`}>
          {blurb}
        </span>
      )}
      {badge && (
        <span
          className={[
            'mt-3 self-start rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase',
            badgeTone === 'suggested'
              ? 'bg-[#f8c8fc]/15 text-[#f8c8fc]'
              : 'bg-[#e97bfc]/20 text-[#f8c8fc]',
          ].join(' ')}
        >
          {badge}
        </span>
      )}
    </label>
  );
}
