// Types shared between the server page and the client registration form.
//
// Deliberately its own module with ZERO imports. `@/lib/registration/capacity`
// (which is where TrackOption is actually produced) imports `@/lib/db` on line 1,
// so importing anything runtime from it into a `"use client"` file drags drizzle
// and node-postgres into the browser bundle. Neither `tsc --noEmit` nor
// `pnpm lint` catches that — only `next build` does. Keep this file import-free.

export type Segment = 'beginner' | 'advanced' | 'capstone';

/** Exactly the shape `trackAvailability()` returns, as the form consumes it. */
export interface TrackOption {
  id: number;
  slug: string;
  name: string;
  segment: Segment;
  /** ISO dates the track runs on, e.g. ['2026-09-17','2026-09-18']. */
  dates: string[];
  /** Seats sold >= capacity. A full track is shown disabled, never silently rejected. */
  full: boolean;
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec',
];

/**
 * '2026-09-17','2026-09-18' -> '17 & 18 Sept 2026'.
 *
 * Formatted by hand rather than with `toLocaleDateString`, whose output depends
 * on the runtime's ICU data — the server and the browser can disagree and React
 * then reports a hydration mismatch.
 */
export function formatDates(dates: string[]): string {
  const parts = dates
    .map((d) => d.split('-'))
    .filter((p): p is [string, string, string] => p.length === 3);
  if (parts.length === 0) return '';

  const [year, month] = parts[0];
  const sameMonth = parts.every((p) => p[0] === year && p[1] === month);
  const monthName = MONTHS[Number(month) - 1] ?? month;

  if (!sameMonth) {
    return parts
      .map(([y, m, d]) => `${Number(d)} ${MONTHS[Number(m) - 1] ?? m} ${y}`)
      .join(', ');
  }

  const days = parts.map(([, , d]) => String(Number(d)));
  const joined = days.length > 1
    ? `${days.slice(0, -1).join(', ')} & ${days[days.length - 1]}`
    : days[0];
  return `${joined} ${monthName} ${year}`;
}
