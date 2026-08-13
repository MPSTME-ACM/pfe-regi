'use client';

import { useEffect, useState } from 'react';
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
} from 'chart.js';
import AdminGate from '@/components/admin/AdminGate';
import BackToAdmin from '@/components/admin/BackToAdmin';
import { Skeleton } from '@/components/stats/chrome';
import Summary from '@/components/stats/Summary';
import { Combinations, TicketMix, TrackSeats } from '@/components/stats/Tickets';
import { Colleges, Departments } from '@/components/stats/Audience';
import { DailyTrend, YearMix } from '@/components/stats/Trend';
import ReferralLeaderboard from '@/components/stats/ReferralLeaderboard';
import type { StatsResponse } from '@/components/stats/types';

// ─────────────────────────────────────────────────────────────────────────────
// Registration statistics.
//
// This file is composition. Each panel lives in components/stats, and the
// palette and Chart.js option objects live in components/stats/theme — Chart.js
// paints to a canvas, so no Tailwind class or CSS variable can reach them.
//
// Filler is registered because `fill: true` on the daily series is otherwise a
// silent no-op: Chart.js drops the area unless the plugin is present.
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

/**
 * Ordered by what gets asked first: how many and how much, then what they
 * bought, then who they are, then who brought them, and the trend last.
 */
function Dashboard({ stats }: { stats: StatsResponse }) {
  return (
    <div className="space-y-4">
      <Summary stats={stats} />

      <section className="grid gap-4 lg:grid-cols-3">
        <Combinations stats={stats} />
        <TicketMix stats={stats} />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <TrackSeats stats={stats} />
        <YearMix stats={stats} />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Departments stats={stats} />
        <Colleges stats={stats} />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <DailyTrend stats={stats} />
        <ReferralLeaderboard stats={stats} />
      </section>
    </div>
  );
}
