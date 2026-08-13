import { google } from 'googleapis';
import { db } from '@/lib/db';
import { registrations, tracks, syncState, syncRuns } from '@/lib/db/schema';
import { and, asc, desc, eq, isNull, lt, or } from 'drizzle-orm';
import {
  SHEET_TAB_2026,
  a1,
  canonicalHeaderRow,
  planSheetSync,
  toCanonicalRow,
  type SheetRegistration,
  type SheetRow,
} from './sheetSync';

/**
 * Google Sheets sync — the impure half.
 *
 * This used to live inside `api/sync-sheet/route.ts`, interleaved with auth and
 * response shaping. It is a plain function now so the in-process scheduler in
 * `src/instrumentation.ts` can call it *directly*: no curl back into ourselves,
 * no HTTP hop, no Basic auth, no dependency on SITE_URL. The trigger that broke
 * in August 2026 was an external cron nobody could find; calling a function
 * removes that whole class of failure rather than reconfiguring it.
 *
 * The diff itself stays pure and dependency-free in `./sheetSync`.
 */

/** How long a claimed lease is honoured before it is treated as abandoned. */
const LEASE_TIMEOUT_MINUTES = 10;

/** Rows of history kept. Enough to see a pattern, not enough to need a page. */
const RUN_HISTORY_LIMIT = 200;

export type SyncSource = 'schedule' | 'http';

export type SyncOutcome =
  | { ok: true; skipped: true; message: string }
  | { ok: true; skipped: false; message: string; updated: number; appended: number }
  | { ok: false; message: string };

const sheets = google.sheets('v4');

/**
 * Built per call rather than once at module scope.
 *
 * The old module-scope client was created when the route file was first
 * imported, which meant a container booted before the Google env vars were set
 * held a permanently unauthenticated client until the next deploy.
 */
function sheetAuth() {
  return new google.auth.JWT({
    email: process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
    key: process.env.GOOGLE_SHEETS_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

async function tabExists(auth: ReturnType<typeof sheetAuth>, spreadsheetId: string) {
  const meta = await sheets.spreadsheets.get({
    auth,
    spreadsheetId,
    fields: 'sheets.properties.title',
  });
  return (meta.data.sheets ?? []).some((s) => s.properties?.title === SHEET_TAB_2026);
}

/**
 * Create the 2026 tab if it is not there yet.
 *
 * Two triggers can fire at once, and a second `addSheet` for a title that now
 * exists is a 400. Re-check on failure rather than surfacing that as an opaque
 * 500.
 */
async function ensureTab(auth: ReturnType<typeof sheetAuth>, spreadsheetId: string) {
  if (await tabExists(auth, spreadsheetId)) return false;
  try {
    await sheets.spreadsheets.batchUpdate({
      auth,
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: SHEET_TAB_2026 } } }] },
    });
    return true;
  } catch (error) {
    if (await tabExists(auth, spreadsheetId)) return false;
    throw error;
  }
}

/**
 * Claim the lease, or return false if someone else holds it.
 *
 * One statement, and that is the whole point. `UPDATE` takes a row lock and
 * re-evaluates its `WHERE` after blocking, so two concurrent callers cannot both
 * come away holding it — no transaction is held open across the Google calls to
 * achieve that. The `startedAt` clause self-heals: a run whose process died
 * mid-flight is reclaimed after LEASE_TIMEOUT_MINUTES instead of wedging the
 * sync permanently.
 */
async function claimLease(source: SyncSource): Promise<boolean> {
  const staleBefore = new Date(Date.now() - LEASE_TIMEOUT_MINUTES * 60_000);
  const claimed = await db
    .update(syncState)
    .set({ running: true, startedAt: new Date(), source })
    .where(
      and(
        eq(syncState.id, 1),
        or(eq(syncState.running, false), isNull(syncState.startedAt), lt(syncState.startedAt, staleBefore)),
      ),
    )
    .returning({ id: syncState.id });

  return claimed.length > 0;
}

async function releaseLease(): Promise<void> {
  await db.update(syncState).set({ running: false }).where(eq(syncState.id, 1));
}

/**
 * Keep the history bounded. Best-effort — a failed prune must not fail a sync.
 *
 * Two plain statements rather than one `DELETE ... WHERE id NOT IN (SELECT ...
 * LIMIT)`. The clever version is raw SQL whose failure mode is a silent no-op,
 * and a prune that quietly does nothing is invisible until the table is huge.
 * Find the cutoff, delete below it.
 */
async function pruneHistory(): Promise<void> {
  try {
    const [cutoff] = await db
      .select({ id: syncRuns.id })
      .from(syncRuns)
      .orderBy(desc(syncRuns.id))
      .limit(1)
      .offset(RUN_HISTORY_LIMIT - 1);

    if (cutoff) await db.delete(syncRuns).where(lt(syncRuns.id, cutoff.id));
  } catch (error) {
    console.error('[SYNC] history prune failed:', error);
  }
}

/** The Google half: read the sheet, diff, apply. No lease or bookkeeping here. */
async function applySync(sheetId: string): Promise<{ message: string; updated: number; appended: number }> {
  const auth = sheetAuth();

  // The tab has to exist before it can be read.
  const [createdTab, dbRegistrations, trackRows] = await Promise.all([
    ensureTab(auth, sheetId),
    db.select().from(registrations).orderBy(asc(registrations.createdAt)),
    // Every track, not `trackAvailability()`: that filters on `enabled`, and a
    // registration can point at a track that has since been switched off.
    db.select({ id: tracks.id, name: tracks.name }).from(tracks),
  ]);

  const trackName = new Map(trackRows.map((t) => [t.id, t.name]));

  const rows: SheetRegistration[] = dbRegistrations.map((reg) => ({
    createdAt: reg.createdAt,
    name: reg.name,
    email: reg.email,
    contact: reg.contact,
    college: reg.college,
    course: reg.course,
    department: reg.department,
    year: reg.year,
    sku: reg.sku,
    beginnerTrackName: reg.beginnerTrackId ? trackName.get(reg.beginnerTrackId) ?? '' : null,
    advancedTrackName: reg.advancedTrackId ? trackName.get(reg.advancedTrackId) ?? '' : null,
    hasCapstone: reg.hasCapstone,
    amountPaid: reg.amountPaid,
    paymentStatus: reg.paymentStatus,
    orderId: reg.orderId,
    referral: reg.referral,
  }));

  const sheetResponse = await sheets.spreadsheets.values.get({
    auth,
    spreadsheetId: sheetId,
    range: a1(SHEET_TAB_2026),
  });
  const sheetValues = (sheetResponse.data.values || []) as SheetRow[];

  // Empty tab (freshly created, or emptied by hand) — stamp the canonical header
  // and everything under it. Note this is `=== 0`: a tab holding only a header
  // row must go down the normal diff path instead.
  if (sheetValues.length === 0) {
    const created = createdTab ? `Created the '${SHEET_TAB_2026}' tab. ` : '';
    if (rows.length === 0) {
      return {
        message: `${created}No database records to sync to the empty '${SHEET_TAB_2026}' tab.`,
        updated: 0,
        appended: 0,
      };
    }
    await sheets.spreadsheets.values.update({
      auth,
      spreadsheetId: sheetId,
      range: a1(SHEET_TAB_2026, 'A1'),
      valueInputOption: 'RAW',
      requestBody: { values: [canonicalHeaderRow(), ...rows.map(toCanonicalRow)] },
    });
    return {
      message: `${created}Initial sync to '${SHEET_TAB_2026}' complete. Added ${rows.length} records.`,
      updated: 0,
      appended: rows.length,
    };
  }

  // Pure — no API calls happen in here.
  const plan = planSheetSync(sheetValues, rows);

  if (plan.updates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      auth,
      spreadsheetId: sheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data: plan.updates.map((u) => ({
          range: a1(SHEET_TAB_2026, `A${u.rowIndex}`),
          values: [u.values],
        })),
      },
    });
  }

  if (plan.appends.length > 0) {
    await sheets.spreadsheets.values.append({
      auth,
      spreadsheetId: sheetId,
      range: a1(SHEET_TAB_2026, 'A1'),
      valueInputOption: 'RAW',
      requestBody: { values: plan.appends },
    });
  }

  const notes: string[] = [];
  if (createdTab) notes.push(`Created the '${SHEET_TAB_2026}' tab.`);
  if (plan.missingHeaders.length > 0) {
    // Not auto-added: inserting a column would shift every cell to its right.
    notes.push(`Skipped columns missing from the sheet: ${plan.missingHeaders.join(', ')}.`);
  }

  return {
    message: [
      `Sync complete. Updated: ${plan.updates.length}. Appended: ${plan.appends.length}.`,
      ...notes,
    ].join(' '),
    updated: plan.updates.length,
    appended: plan.appends.length,
  };
}

/**
 * Run a sync, serialised against every other trigger and recorded either way.
 *
 * Never throws. The scheduler has no caller to report to, and the route turns
 * the outcome into a status code — neither wants an exception.
 */
export async function runSheetSync(
  source: SyncSource,
  triggerNote?: string | null,
): Promise<SyncOutcome> {
  // Captured here, not left to the column default: the row is INSERTed when the
  // run *finishes*, so `defaultNow()` would stamp every run with its end time
  // and the duration of every run would read as zero.
  const startedAt = new Date();

  const sheetId = process.env.GOOGLE_SHEETS_SHEET_ID;
  if (!sheetId) {
    const message = 'Missing GOOGLE_SHEETS_SHEET_ID env variable';
    console.error('[SYNC ERROR]', message);
    await recordRun(source, triggerNote, startedAt, false, 0, 0, message);
    return { ok: false, message };
  }

  let holdsLease = false;
  try {
    holdsLease = await claimLease(source);
  } catch (error) {
    // A lease read that fails is a DB problem, and running anyway would risk the
    // duplicate appends the lease exists to prevent. Report rather than proceed.
    const message = error instanceof Error ? error.message : 'Could not claim the sync lease';
    console.error('[SYNC ERROR] lease claim failed:', error);
    return { ok: false, message };
  }

  if (!holdsLease) {
    return { ok: true, skipped: true, message: 'A sync is already running; this one was skipped.' };
  }

  try {
    const result = await applySync(sheetId);
    await recordRun(source, triggerNote, startedAt, true, result.updated, result.appended, null);
    return { ok: true, skipped: false, ...result };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unknown sync error occurred';
    console.error('[SYNC ERROR]', error);
    await recordRun(source, triggerNote, startedAt, false, 0, 0, message);
    return { ok: false, message };
  } finally {
    // In a `finally` so a thrown Google error still frees the lease. Without it
    // one network blip would block every sync for LEASE_TIMEOUT_MINUTES.
    try {
      await releaseLease();
    } catch (error) {
      console.error('[SYNC] lease release failed (it will time out):', error);
    }
  }
}

/** Bookkeeping must never be what fails a sync that actually worked. */
async function recordRun(
  source: SyncSource,
  triggerNote: string | null | undefined,
  startedAt: Date,
  ok: boolean,
  updated: number,
  appended: number,
  error: string | null,
): Promise<void> {
  try {
    await db.insert(syncRuns).values({
      source,
      triggerNote: triggerNote?.slice(0, 200) ?? null,
      startedAt,
      finishedAt: new Date(),
      ok,
      updated,
      appended,
      error: error?.slice(0, 1000) ?? null,
    });
    await pruneHistory();
  } catch (dbError) {
    console.error('[SYNC] could not record the run:', dbError);
  }
}

export interface SyncHistory {
  runs: SyncRunSummary[];
  lastSuccessAt: string | null;
}

export interface SyncRunSummary {
  id: number;
  source: SyncSource;
  triggerNote: string | null;
  startedAt: string | null;
  ok: boolean;
  updated: number;
  appended: number;
  error: string | null;
}

/**
 * Recent runs, newest first.
 *
 * Fail-soft, like `getSettings()` and `safeTrackAvailability()`: a panel about
 * observability must never be the thing that takes a page down.
 */
export async function syncHistory(limit = 20): Promise<SyncHistory> {
  try {
    const rows = await db
      .select()
      .from(syncRuns)
      .orderBy(desc(syncRuns.id))
      .limit(limit);

    const [lastOk] = await db
      .select({ startedAt: syncRuns.startedAt })
      .from(syncRuns)
      .where(eq(syncRuns.ok, true))
      .orderBy(desc(syncRuns.id))
      .limit(1);

    return {
      runs: rows.map((r) => ({
        id: r.id,
        source: r.source,
        triggerNote: r.triggerNote,
        startedAt: r.startedAt ? r.startedAt.toISOString() : null,
        ok: r.ok,
        updated: r.updated,
        appended: r.appended,
        error: r.error,
      })),
      lastSuccessAt: lastOk?.startedAt ? lastOk.startedAt.toISOString() : null,
    };
  } catch (error) {
    console.error('[SYNC] history read failed:', error);
    return { runs: [], lastSuccessAt: null };
  }
}
