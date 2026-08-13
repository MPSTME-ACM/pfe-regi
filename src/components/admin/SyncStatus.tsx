'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Sheet-sync observability, shared by /admin (the banner) and /sync (the log).
 *
 * This exists because of a two-day outage nobody could see: the trigger stopped
 * firing, nothing recorded that it had, and the only symptom was a spreadsheet
 * quietly falling behind. "Last synced" now has somewhere to be read.
 */

export interface SyncRunSummary {
  id: number;
  source: 'schedule' | 'http';
  triggerNote: string | null;
  startedAt: string | null;
  ok: boolean;
  updated: number;
  appended: number;
  error: string | null;
}

export interface SyncHistoryState {
  runs: SyncRunSummary[];
  lastSuccessAt: string | null;
  /** Null until the first fetch resolves — distinct from "loaded, and empty". */
  loaded: boolean;
}

const EMPTY: SyncHistoryState = { runs: [], lastSuccessAt: null, loaded: false };

/**
 * Poll the run log.
 *
 * Fail-soft by construction: a failed fetch leaves the previous state alone and
 * never throws into the render tree. A panel about observability must not be
 * the thing that takes the page down.
 */
export function useSyncHistory(creds: string, enabled = true) {
  const [state, setState] = useState<SyncHistoryState>(EMPTY);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await fetch('/api/sync-sheet', { headers: { Authorization: creds } });
      if (!res.ok) return;
      const data = await res.json();
      if (!data.success) return;
      setState({ runs: data.runs ?? [], lastSuccessAt: data.lastSuccessAt ?? null, loaded: true });
    } catch {
      // Keep whatever we had. A blip is not worth blanking the panel.
    }
  }, [creds, enabled]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { ...state, refresh };
}

/** "4 minutes ago". Absolute timestamps are in the log; this is for the banner. */
export function relativeTime(iso: string | null): string {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'unknown';

  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** Minutes since a successful run, or Infinity if there has never been one. */
function minutesSince(iso: string | null): number {
  if (!iso) return Infinity;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return Infinity;
  return (Date.now() - then) / 60_000;
}

/**
 * The warning on /admin.
 *
 * Renders nothing while healthy — a banner that is always present is a banner
 * nobody reads. `staleAfterMinutes` defaults to twice the ten-minute scheduler
 * interval, so one missed tick is tolerated and two are not.
 */
export function SyncStaleBanner({
  lastSuccessAt,
  loaded,
  staleAfterMinutes = 20,
}: {
  lastSuccessAt: string | null;
  loaded: boolean;
  staleAfterMinutes?: number;
}) {
  // Before the first fetch resolves we know nothing, and claiming the sync is
  // broken on every page load would train everyone to ignore this.
  if (!loaded) return null;
  if (minutesSince(lastSuccessAt) < staleAfterMinutes) return null;

  return (
    <div
      role="alert"
      className="mt-4 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3"
    >
      <p className="text-sm font-medium text-amber-200">
        Google Sheet is not syncing
      </p>
      <p className="mt-1 text-sm leading-relaxed text-amber-100/80">
        Last successful sync: {relativeTime(lastSuccessAt)}. Registrations are safe in the
        database — only the spreadsheet is behind.{' '}
        <a href="/sync" className="underline underline-offset-2 hover:text-white">
          Open Sync
        </a>{' '}
        to see why and run one by hand.
      </p>
    </div>
  );
}

function SourceTag({ run }: { run: SyncRunSummary }) {
  const scheduled = run.source === 'schedule';
  return (
    <span
      title={run.triggerNote ?? undefined}
      className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${
        scheduled ? 'bg-white/10 text-gray-300' : 'bg-accent/15 text-accent-soft'
      }`}
    >
      {scheduled ? 'scheduled' : 'manual / api'}
    </span>
  );
}

/**
 * The run log on /sync.
 *
 * `triggerNote` carries the caller's User-Agent, which is the point: if a cron
 * we cannot find is still alive out there, it shows up here as an `http` run
 * with a curl-shaped agent rather than staying invisible.
 */
export function SyncRunLog({ runs, loaded }: { runs: SyncRunSummary[]; loaded: boolean }) {
  if (!loaded) {
    return <p className="text-sm text-gray-400">Loading recent runs…</p>;
  }

  if (runs.length === 0) {
    return (
      <p className="text-sm leading-relaxed text-gray-400">
        No runs recorded yet. The scheduler runs a few seconds after the app starts and
        every 10 minutes after that.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-white/[0.06]">
      {runs.map((run) => (
        <li key={run.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5">
          <span
            aria-hidden
            className={`h-2 w-2 shrink-0 self-center rounded-full ${
              run.ok ? 'bg-emerald-400' : 'bg-red-400'
            }`}
          />
          <span className="text-sm text-gray-300">{relativeTime(run.startedAt)}</span>
          <SourceTag run={run} />
          {run.ok ? (
            <span className="text-sm text-gray-400">
              {run.updated === 0 && run.appended === 0
                ? 'no changes'
                : `${run.appended} added, ${run.updated} updated`}
            </span>
          ) : (
            <span className="min-w-0 break-words text-sm text-red-300">
              {run.error || 'failed'}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
