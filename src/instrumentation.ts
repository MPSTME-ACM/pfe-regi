/**
 * The sheet sync timer.
 *
 * ── Why this is in the repo at all ──────────────────────────────────────────
 * The sync was previously fired by a cron configured outside this codebase. In
 * August 2026 it stopped, and nobody could say where it had been configured or
 * why it quit — the only trace of it anywhere was `apk add curl` in the
 * Dockerfile. Registrations went two days without reaching the spreadsheet.
 *
 * A docker-compose sidecar would be tidier in principle, but the repo ships both
 * a Dockerfile and a docker-compose.yaml and we do not know which one Coolify
 * actually builds — a sidecar could silently never deploy, which is precisely
 * the failure being fixed. `instrumentation.ts` ships with the application by
 * construction and needs no external configuration.
 *
 * ── Why in-memory state is acceptable here, when CLAUDE.md warns against it ──
 * The warning is about `lastSentTimes`, the email throttle: that is *incorrect*
 * behind a load balancer because each instance holds a divergent copy of state
 * that is supposed to be authoritative. This holds no state. It is a timer whose
 * only effect is calling a function that is idempotent by construction (the diff
 * is recomputed from scratch every run) and serialised by a database lease. Two
 * instances mean two ticks, and the second is skipped, not doubled.
 */

const DEFAULT_INTERVAL_MINUTES = 10;

export async function register() {
  // `register()` is invoked for the edge runtime too, where neither `pg` nor
  // `setInterval`-driven background work belongs.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // Off in development unless explicitly asked for, and this is not caution for
  // its own sake: GOOGLE_SHEETS_SHEET_ID in a local .env is usually the *real*
  // spreadsheet, because that is the only one the service account can reach. A
  // scheduler that starts with `pnpm dev` therefore syncs whatever test rows are
  // in the local database straight into the live sheet. That happened once,
  // while verifying this very file — eleven local registrations landed in
  // PFE2026 and had to be deleted by hand.
  if (process.env.NODE_ENV !== 'production' && process.env.SYNC_IN_DEV !== 'true') {
    console.log('[SYNC] scheduler disabled in development (set SYNC_IN_DEV=true to override)');
    return;
  }

  const raw = process.env.SYNC_INTERVAL_MINUTES;
  const minutes = raw === undefined || raw === '' ? DEFAULT_INTERVAL_MINUTES : Number(raw);

  if (!Number.isFinite(minutes) || minutes <= 0) {
    console.log('[SYNC] scheduler disabled (SYNC_INTERVAL_MINUTES <= 0 or unparseable)');
    return;
  }

  // Imported lazily so `@/lib/db` and googleapis are not pulled in at all when
  // the scheduler is switched off.
  const { runSheetSync } = await import('@/lib/registration/runSheetSync');

  const tick = async () => {
    const result = await runSheetSync('schedule');
    // Errors are already logged and recorded by runSheetSync, which never
    // throws — so there is nothing here that can take the server down.
    if (result.ok && !result.skipped && (result.updated > 0 || result.appended > 0)) {
      console.log(`[SYNC] ${result.message}`);
    }
  };

  // A catch-up run shortly after boot, not a full interval later. A deploy is
  // exactly when the sheet is most likely to be behind, and waiting out the
  // interval is how the last outage stayed invisible for as long as it did.
  // Delayed rather than immediate so it does not compete with serving the first
  // requests, and skipped harmlessly if another instance is already syncing.
  const firstRun = setTimeout(tick, 30_000);

  const timer = setInterval(tick, minutes * 60_000);

  // Without these the timers keep the event loop alive and the container ignores
  // SIGTERM for up to a full interval on every deploy.
  firstRun.unref?.();
  timer.unref?.();

  console.log(`[SYNC] scheduler started, every ${minutes} minute(s)`);
}
