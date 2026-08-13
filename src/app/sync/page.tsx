'use client';

import { useState } from 'react';
import AdminGate, { clearStoredCreds } from '@/components/admin/AdminGate';
import BackToAdmin from '@/components/admin/BackToAdmin';
import { SyncRunLog, relativeTime, useSyncHistory } from '@/components/admin/SyncStatus';

// ─────────────────────────────────────────────────────────────────────────────
// Manual Google Sheets sync.
//
// The login form here was a copy of the one in components/admin/AdminGate, with
// its own auth state on top. It is the shared gate now: same /api/login check,
// same `admin-creds` credential, replayed on the POST to /api/sync-sheet.
//
// The result used to arrive as an alert(). A sync reports counts worth reading
// twice ("Updated: 3. Appended: 11."), and an alert throws that away the moment
// it is dismissed, so it is rendered on the page instead.
// ─────────────────────────────────────────────────────────────────────────────

export default function SyncPage() {
  return <AdminGate title="Sync">{({ creds, logout }) => <SyncPanel creds={creds} logout={logout} />}</AdminGate>;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'ok'; message: string; at: string }
  | { kind: 'error'; message: string }
  /** The credential was rejected mid-session: it is cleared, so re-auth is the
   *  only way forward and the sync button stays disabled until then. */
  | { kind: 'expired' };

function SyncPanel({ creds, logout }: { creds: string; logout: () => void }) {
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const history = useSyncHistory(creds);

  const handleSync = async () => {
    setIsLoading(true);
    setStatus({ kind: 'idle' });

    try {
      const response = await fetch('/api/sync-sheet', {
        method: 'POST',
        headers: { Authorization: creds },
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          clearStoredCreds();
          setStatus({ kind: 'expired' });
        } else {
          setStatus({
            kind: 'error',
            message: data.message || data.error || 'Unknown error',
          });
        }
      } else {
        setStatus({
          kind: 'ok',
          message: data.message || 'Data synced successfully!',
          at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        });
      }

      // Whatever happened, the run log has a new row worth showing.
      history.refresh();
    } catch (error: unknown) {
      setStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }

    setIsLoading(false);
  };

  const locked = status.kind === 'expired';

  return (
    <main className="min-h-screen bg-panel text-white px-4 py-8 sm:px-6 sm:py-10">
      <div className="mx-auto w-full max-w-2xl">
        <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Admin Controls</h1>
          <div className="flex items-center gap-2">
            <BackToAdmin />
            <button
              onClick={logout}
              className="inline-flex min-h-11 items-center rounded-lg border border-hairline bg-white/5 px-4 text-sm font-medium text-gray-300 transition-colors hover:border-hairline hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-soft"
            >
              Logout
            </button>
          </div>
        </header>

        <section className="rounded-2xl border border-hairline bg-panel-raised p-5 sm:p-7">
          <h2 className="text-base font-semibold text-accent-soft">Google Sheets</h2>
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-gray-300">
            The sheet syncs on its own every few minutes. This button forces one now — it
            is not the only thing keeping the sheet up to date.
          </p>
          <p className="mt-2 text-sm text-gray-400">
            Last successful sync: <span className="text-gray-200">
              {history.loaded ? relativeTime(history.lastSuccessAt) : '…'}
            </span>
          </p>

          <button
            onClick={handleSync}
            disabled={isLoading || locked}
            className="mt-6 inline-flex min-h-11 items-center justify-center rounded-lg bg-accent px-5 py-3 font-bold text-black transition-[transform,box-shadow,opacity] duration-200 ease-out hover:shadow-lg hover:shadow-accent/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:scale-[0.99] disabled:opacity-50 disabled:active:scale-100"
          >
            {isLoading ? 'Syncing...' : 'Sync to Google Sheets'}
          </button>

          <div aria-live="polite" className="mt-5 empty:mt-0">
            {status.kind === 'ok' && (
              <div className="rounded-lg border border-accent/30 bg-accent/10 px-4 py-3">
                <p className="text-sm text-accent-soft">{status.message}</p>
                <p className="mt-1 text-xs text-gray-400">Last run at {status.at}</p>
              </div>
            )}

            {status.kind === 'error' && (
              <p
                role="alert"
                className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300"
              >
                Sync failed: {status.message}
              </p>
            )}

            {locked && (
              <div
                role="alert"
                className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3"
              >
                <p className="text-sm text-red-300">
                  Authentication failed. Please log in again.
                </p>
                <button
                  onClick={logout}
                  className="mt-3 inline-flex min-h-11 items-center rounded-lg border border-white/15 bg-white/5 px-4 text-sm font-medium text-white transition-colors hover:border-white/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-soft"
                >
                  Sign in again
                </button>
              </div>
            )}
          </div>
        </section>

        {/* The reason this panel exists: when the sync stopped in August 2026 it
            failed silently for two days. A run that 401s or 500s now leaves a
            visible row here instead of only a line in container logs nobody
            reads. The source tag also names any external trigger still alive. */}
        <section className="mt-5 rounded-2xl border border-hairline bg-panel-raised p-5 sm:p-7">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-base font-semibold text-accent-soft">Recent runs</h2>
            <button
              onClick={history.refresh}
              className="text-sm text-gray-400 underline underline-offset-2 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-soft"
            >
              Refresh
            </button>
          </div>
          <div className="mt-3">
            <SyncRunLog runs={history.runs} loaded={history.loaded} />
          </div>
        </section>
      </div>
    </main>
  );
}
