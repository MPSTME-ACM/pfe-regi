import type { ChartOptions } from 'chart.js';

/**
 * Palette and Chart.js option objects for /stats.
 *
 * Chart.js paints to a canvas, so none of this can come from a Tailwind class or
 * a CSS variable — the values are JS literals by necessity, and this file is
 * where they live so the panels do not each invent their own.
 */

/* ── Palette ───────────────────────────────────────────────────────────────
 * A ramp from the product accent through violet to teal: seven tracks stay
 * tellable apart on a dark surface without leaving the family. Amber is kept
 * out of it on purpose — it means "awaiting payment" on this page, and a track
 * wearing it would read as a status.
 */
export const SERIES = [
  '#e97bfc', // accent magenta
  '#c084fc',
  '#a78bfa',
  '#818cf8',
  '#60a5fa',
  '#22d3ee',
  '#5eead4',
] as const;

/**
 * Colour for series `i` of `count`, spread across the whole ramp.
 *
 * Seven series take it end to end; four take every other step instead of four
 * neighbouring purples. Sizing to the data also fixes the year chart, which
 * used to slice a two-colour array against four buckets and let Chart.js fill
 * the remainder with its own off-palette defaults.
 *
 * Past seven — an eighth track is one admin edit away — it cycles instead of
 * spreading, which repeats a colour but never puts two identical ones side by
 * side.
 */
export const hue = (i: number, count: number) =>
  count > SERIES.length
    ? SERIES[i % SERIES.length]
    : SERIES[Math.round((i * (SERIES.length - 1)) / Math.max(count - 1, 1))];

/** Status colours. These three mean one thing each, everywhere on the page. */
export const CONFIRMED = '#e97bfc';
export const AWAITING = '#fbbf24';
export const FAILED = '#f87171';

export const GRID = 'rgba(255,255,255,0.08)';
export const AXIS_BORDER = 'rgba(255,255,255,0.15)';

export const tooltipStyle = {
  backgroundColor: 'rgba(40,40,45,0.96)',
  borderColor: 'rgba(255,255,255,0.15)',
  borderWidth: 1,
  titleColor: '#f8c8fc',
  bodyColor: '#e5e7eb',
  padding: 10,
  cornerRadius: 8,
  usePointStyle: true,
} as const;

export const nf = new Intl.NumberFormat('en-IN');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2026-08-09` → `Aug 9`. Ten full ISO dates do not fit on a 375px axis. */
export function shortDay(iso: string) {
  const [, m, d] = iso.split('-');
  const month = MONTHS[Number(m) - 1];
  return month ? `${month} ${Number(d)}` : iso;
}

/* ── Chart options ─────────────────────────────────────────────────────────
 * Annotated rather than inferred: bare object literals widen `'y'` to `string`
 * and stop being assignable to Chart.js' option types.
 */

export const horizontalBarOptions: ChartOptions<'bar'> = {
  indexAxis: 'y',
  responsive: true,
  maintainAspectRatio: false,
  layout: { padding: { right: 8 } },
  plugins: {
    legend: { display: false }, // one series; the card title already names it
    tooltip: tooltipStyle,
  },
  scales: {
    x: {
      beginAtZero: true,
      ticks: { precision: 0 },
      grid: { color: GRID },
      border: { color: AXIS_BORDER },
    },
    y: {
      grid: { display: false },
      border: { color: AXIS_BORDER },
      ticks: { autoSkip: false, font: { size: 11 } },
    },
  },
};

export const barOptions: ChartOptions<'bar'> = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: tooltipStyle,
  },
  scales: {
    x: { grid: { display: false }, border: { color: AXIS_BORDER } },
    y: {
      beginAtZero: true,
      ticks: { precision: 0 },
      grid: { color: GRID },
      border: { color: AXIS_BORDER },
    },
  },
};

export const lineOptions = (isoDays: string[]): ChartOptions<'line'> => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  elements: {
    line: { tension: 0.35, borderWidth: 2 },
    point: { radius: 3, hoverRadius: 6, borderWidth: 0 },
  },
  plugins: {
    legend: {
      position: 'top',
      align: 'end',
      labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 8, padding: 16 },
    },
    tooltip: {
      ...tooltipStyle,
      // The axis is abbreviated to fit; the tooltip gives the full date back.
      callbacks: { title: (items) => isoDays[items[0]?.dataIndex ?? 0] ?? '' },
    },
  },
  scales: {
    x: {
      grid: { color: GRID },
      border: { color: AXIS_BORDER },
      ticks: { maxRotation: 0, autoSkipPadding: 12 },
    },
    y: {
      beginAtZero: true,
      ticks: { precision: 0 },
      grid: { color: GRID },
      border: { color: AXIS_BORDER },
    },
  },
});

export const doughnutOptions: ChartOptions<'doughnut'> = {
  responsive: true,
  maintainAspectRatio: false,
  cutout: '62%',
  plugins: {
    legend: {
      position: 'bottom',
      labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 8, padding: 14 },
    },
    tooltip: tooltipStyle,
  },
};
