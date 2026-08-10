'use client';

import { useEffect, useState } from 'react';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  BarElement,
  CategoryScale,
  LinearScale,
  ArcElement,
  Tooltip,
  Legend,
  PointElement,
  LineElement,
  Filler,
  type ChartOptions,
} from 'chart.js';
import AdminGate from '@/components/admin/AdminGate';
import BackToAdmin from '@/components/admin/BackToAdmin';

// ─────────────────────────────────────────────────────────────────────────────
// Registration statistics.
//
// The login form that used to live in this file was the third copy of the one
// in components/admin/AdminGate — and the copy had drifted: two `if (!authCreds)`
// branches, the second unreachable, and a logout that reloaded the page. It is
// the shared gate now. Same /api/login check, same `admin-creds` credential.
//
// Filler is registered because `fill: true` on the daily series was previously
// a silent no-op: Chart.js drops the area unless the plugin is present.
// ─────────────────────────────────────────────────────────────────────────────

ChartJS.register(
  BarElement,
  CategoryScale,
  LinearScale,
  ArcElement,
  Tooltip,
  Legend,
  PointElement,
  LineElement,
  Filler
);

ChartJS.defaults.color = '#d1d5db'; // gray-300: axis ticks and legends
ChartJS.defaults.font.size = 12;

interface StatsResponse {
  success: boolean;
  total: number;
  totalAll: number;
  pending: number;
  successPercent: number;
  pendingPercent: number;
  domains: Record<string, number>;
  years: Record<string, number>;
  daily: Record<string, { success: number; pending: number }>;
}

/* ── Palette ───────────────────────────────────────────────────────────────
 * A ramp from the product accent through violet to teal: seven tracks stay
 * tellable apart on a dark surface without leaving the family. Amber is kept
 * out of it on purpose — it means "pending" on this page, and a track wearing
 * it would read as a status.
 */
const SERIES = [
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
const hue = (i: number, count: number) =>
  count > SERIES.length
    ? SERIES[i % SERIES.length]
    : SERIES[Math.round((i * (SERIES.length - 1)) / Math.max(count - 1, 1))];

const CONFIRMED = '#e97bfc';
const AWAITING = '#fbbf24';

const GRID = 'rgba(255,255,255,0.08)';
const AXIS_BORDER = 'rgba(255,255,255,0.15)';

const tooltipStyle = {
  backgroundColor: 'rgba(40,40,45,0.96)',
  borderColor: 'rgba(255,255,255,0.15)',
  borderWidth: 1,
  titleColor: '#f8c8fc',
  bodyColor: '#e5e7eb',
  padding: 10,
  cornerRadius: 8,
  usePointStyle: true,
} as const;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2026-08-09` → `Aug 9`. Ten full ISO dates do not fit on a 375px axis. */
function shortDay(iso: string) {
  const [, m, d] = iso.split('-');
  const month = MONTHS[Number(m) - 1];
  return month ? `${month} ${Number(d)}` : iso;
}

const nf = new Intl.NumberFormat('en-IN');

/* ── Page ──────────────────────────────────────────────────────────────── */

export default function StatsPage() {
  return (
    <AdminGate title="Statistics">
      {({ creds, logout }) => <StatsPanel creds={creds} logout={logout} />}
    </AdminGate>
  );
}

function StatsPanel({ creds, logout }: { creds: string; logout: () => void }) {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const fetchStats = async () => {
      try {
        const res = await fetch('/api/stats', { headers: { Authorization: creds } });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Failed to fetch stats');
        if (!cancelled) setStats(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchStats();
    return () => {
      cancelled = true;
    };
  }, [creds]);

  return (
    <main className="min-h-screen bg-panel text-white px-4 py-8 sm:px-6 sm:py-10">
      <div className="mx-auto w-full max-w-6xl">
        <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Admin Statistics</h1>
          <div className="flex items-center gap-2">
            <BackToAdmin />
            <button
              onClick={logout}
              className="inline-flex min-h-11 items-center rounded-lg border border-hairline bg-white/5 px-4 text-sm font-medium text-gray-300 transition-colors hover:border-hairline/80 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-soft"
            >
              Logout
            </button>
          </div>
        </header>

        {loading && <Skeleton />}

        {!loading && error && (
          <p
            role="alert"
            className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300"
          >
            {error}
          </p>
        )}

        {!loading && !error && stats && <Dashboard stats={stats} />}
      </div>
    </main>
  );
}

function Dashboard({ stats }: { stats: StatsResponse }) {
  const trackLabels = Object.keys(stats.domains);
  const trackValues = Object.values(stats.domains);

  const yearLabels = Object.keys(stats.years);
  const yearValues = Object.values(stats.years);

  const dayKeys = Object.keys(stats.daily);
  const dayLabels = dayKeys.map(shortDay);

  return (
    <div className="space-y-4">
      <Summary stats={stats} />

      <section className="grid gap-4 lg:grid-cols-3">
        <Card
          title="Seats sold by track"
          note="Successful and comped registrations. A bundle occupies three seats."
          className="lg:col-span-2"
        >
          {/* Horizontal: seven track names read straight at 375px instead of
              being rotated 45° and clipped. */}
          {trackValues.every(v => v === 0) ? (
            <EmptyState message="No seats sold yet." />
          ) : (
            <ChartBox height="h-[320px] sm:h-[340px]">
              <Bar
                data={{
                  labels: trackLabels,
                  datasets: [
                    {
                      label: 'Seats sold',
                      data: trackValues,
                      backgroundColor: trackLabels.map((_, i) => hue(i, trackLabels.length)),
                      hoverBackgroundColor: trackLabels.map((_, i) => hue(i, trackLabels.length)),
                      borderRadius: 5,
                      borderSkipped: false,
                      maxBarThickness: 26,
                    },
                  ],
                }}
                options={horizontalBarOptions}
              />
            </ChartBox>
          )}
        </Card>

        <Card title="Registration status">
          <ChartBox height="h-[320px] sm:h-[340px]">
            <Bar
              data={{
                labels: ['Successful', 'Pending'],
                datasets: [
                  {
                    label: 'Registrations',
                    data: [stats.total, stats.pending || 0],
                    backgroundColor: [CONFIRMED, AWAITING],
                    borderRadius: 6,
                    borderSkipped: false,
                    maxBarThickness: 64,
                  },
                ],
              }}
              options={barOptions}
            />
          </ChartBox>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Card title="Daily registrations" note="Last 10 days" className="lg:col-span-2">
          {Object.values(stats.daily).every(d => d.success === 0 && d.pending === 0) ? (
            <EmptyState message="No registrations in the last 10 days." />
          ) : (
            <ChartBox height="h-[280px] sm:h-[300px]">
              <Line
                data={{
                  labels: dayLabels,
                  datasets: [
                    {
                      label: 'Successful',
                      data: dayKeys.map((d) => stats.daily[d].success),
                      borderColor: CONFIRMED,
                      backgroundColor: 'rgba(233,123,252,0.14)',
                      pointBackgroundColor: CONFIRMED,
                      fill: true,
                    },
                    {
                      label: 'Pending',
                      data: dayKeys.map((d) => stats.daily[d].pending),
                      borderColor: AWAITING,
                      backgroundColor: 'rgba(251,191,36,0.12)',
                      pointBackgroundColor: AWAITING,
                      fill: true,
                    },
                  ],
                }}
                options={lineOptions(dayKeys)}
              />
            </ChartBox>
          )}
        </Card>

        <Card title="Year-wise registrations" note="Successful registrations">
          {yearLabels.length === 0 ? (
            <EmptyState message="No data available." />
          ) : (
            <ChartBox height="h-[280px] sm:h-[300px]">
              <Doughnut
                data={{
                  labels: yearLabels,
                  datasets: [
                    {
                      label: 'Registrations',
                      data: yearValues,
                      backgroundColor: yearLabels.map((_, i) => hue(i, yearLabels.length)),
                      borderColor: 'rgba(57,57,57,0.9)',
                      borderWidth: 2,
                      hoverOffset: 6,
                    },
                  ],
                }}
                options={doughnutOptions}
              />
            </ChartBox>
          )}
        </Card>
      </section>
    </div>
  );
}

/* ── Summary ───────────────────────────────────────────────────────────────
 * One proportional band rather than four boxes of giant numbers: the useful
 * fact here is how much of the total has actually converted, and a meter says
 * that in one glance where four detached counters make you do the division.
 */
function Summary({ stats }: { stats: StatsResponse }) {
  const empty = stats.totalAll === 0;
  const successW = empty ? 0 : (stats.total / stats.totalAll) * 100;

  return (
    <section className="rounded-2xl border border-hairline bg-panel-raised p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-sm font-medium uppercase tracking-wider text-gray-300">
          Total registered
        </h2>
        <span className="text-3xl font-semibold tabular-nums text-white">
          {nf.format(stats.totalAll)}
        </span>
      </div>

      {empty ? (
        <p className="mt-3 text-sm text-gray-400">No registrations yet.</p>
      ) : (
        <>
          <div
            className="mt-5 flex h-2.5 w-full overflow-hidden rounded-full bg-white/[0.08]"
            role="img"
            aria-label={`${stats.successPercent}% successful, ${stats.pendingPercent}% pending`}
          >
            {/* Only the confirmed portion is filled; the rest stays the neutral
                rail. Filling the remainder amber meant that a day with one
                pending registration and no confirmed ones rendered as a solid
                full-width amber bar, which reads as an alarm rather than as
                "nothing has settled yet". The pending count is in the legend
                below, where a number belongs. */}
            <div style={{ width: `${successW}%`, backgroundColor: CONFIRMED }} />
          </div>

          <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
            <Figure
              color={CONFIRMED}
              label="Successful"
              value={stats.total}
              percent={stats.successPercent}
            />
            <Figure
              color={AWAITING}
              label="Pending"
              value={stats.pending}
              percent={stats.pendingPercent}
            />
          </dl>
        </>
      )}
    </section>
  );
}

function Figure({
  color,
  label,
  value,
  percent,
}: {
  color: string;
  label: string;
  value: number;
  percent: number;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden
        className="size-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      <dt className="text-sm text-gray-300">{label}</dt>
      <dd className="text-sm text-white">
        <span className="font-semibold tabular-nums">{nf.format(value)}</span>
        <span className="ml-1.5 text-gray-400 tabular-nums">{percent.toFixed(1)}%</span>
      </dd>
    </div>
  );
}

/* ── Shells ────────────────────────────────────────────────────────────── */

function Card({
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
function ChartBox({ height, children }: { height: string; children: React.ReactNode }) {
  return <div className={`relative w-full ${height}`}>{children}</div>;
}

/** Empty state for charts: centered text, much shorter than chart box. */
function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex w-full min-h-[80px] items-center justify-center">
      <p className="text-sm text-gray-400">{message}</p>
    </div>
  );
}

function Skeleton() {
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

/* ── Chart options ─────────────────────────────────────────────────────────
 * Annotated rather than inferred: bare object literals widen `'y'` to `string`
 * and stop being assignable to Chart.js' option types.
 */

const horizontalBarOptions: ChartOptions<'bar'> = {
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

const barOptions: ChartOptions<'bar'> = {
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

const lineOptions = (isoDays: string[]): ChartOptions<'line'> => ({
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

const doughnutOptions: ChartOptions<'doughnut'> = {
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
