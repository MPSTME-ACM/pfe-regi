'use client';

import React from 'react';

/**
 * Shared shells for the /stats panels.
 *
 * Lifted out of `app/stats/page.tsx` unchanged when that file outgrew a single
 * screen. Nothing here knows what a statistic is; it is card, box, empty state
 * and skeleton.
 */

export function Card({
  title,
  note,
  className = '',
  children,
}: {
  title: string;
  note?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`min-w-0 rounded-2xl border border-hairline bg-panel-raised p-4 sm:p-5 ${className}`}
    >
      <h2 className="text-base font-semibold text-[#f8c8fc]">{title}</h2>
      {note && <p className="mt-0.5 text-xs text-gray-400">{note}</p>}
      <div className="mt-4">{children}</div>
    </div>
  );
}

/** Fixed-height, full-width box: canvases size to the card, never past it. */
export function ChartBox({ height, children }: { height: string; children: React.ReactNode }) {
  return <div className={`relative w-full ${height}`}>{children}</div>;
}

/**
 * Empty state for charts: centered text, much shorter than a chart box.
 *
 * Rendered *instead of* a ChartBox, never inside one — otherwise the fixed
 * `h-[320px]` survives and the card is an empty frame with a caption in it.
 */
export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex w-full min-h-[80px] items-center justify-center">
      <p className="text-sm text-gray-400">{message}</p>
    </div>
  );
}

export function Skeleton() {
  return (
    <div className="space-y-4" role="status">
      <span className="sr-only">Loading stats...</span>
      <div aria-hidden className="h-32 animate-pulse rounded-2xl border border-white/10 bg-white/[0.04]" />
      <div aria-hidden className="grid gap-4 lg:grid-cols-3">
        <div className="h-72 animate-pulse rounded-2xl border border-white/10 bg-white/[0.04] lg:col-span-2" />
        <div className="h-72 animate-pulse rounded-2xl border border-white/10 bg-white/[0.04]" />
      </div>
    </div>
  );
}
