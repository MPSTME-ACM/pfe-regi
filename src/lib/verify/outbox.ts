// ─────────────────────────────────────────────────────────────────────────────
// The door scanner's offline outbox.
//
// A volunteer with no network still marks attendance: every save lands here
// first and is replayed against POST /api/verify/batch when the network
// returns. The queue is a plain array, persisted to localStorage by the page,
// so a phone reload mid-event loses nothing.
//
// Coalescing is safe because the server merges with jsonb `||`: per date-key,
// last write wins on both sides. So ten marks on one ticket collapse into a
// single patch carrying each day's latest value — the flush sends the same
// bytes as ten individual requests would have produced.
//
// Everything here is pure (storage and fetch are injected at the edges), so it
// is exhaustively testable without a browser.
// ─────────────────────────────────────────────────────────────────────────────

export interface OutboxEntry {
  orderId: string;
  /** Latest value per date key. Merged, never appended to. */
  patch: Record<string, boolean>;
  /** ms epoch of the FIRST unsynced mark — the age the UI reports. */
  queuedAt: number;
  /** Failed flush attempts. Surfaced, never a reason to drop. */
  tries: number;
}

/** One item of the batch endpoint's `updates` array. */
export interface BatchUpdate {
  orderId: string;
  attendance: Record<string, boolean>;
}

/** One item of the batch endpoint's `results` array. */
export interface BatchItemResult {
  orderId: string;
  ok: boolean;
  /** Set on failure. 'not_found'/'invalid' tell the client to drop the queued
   *  item instead of retrying forever. */
  error?: 'not_found' | 'invalid' | 'server';
  message?: string;
  /** The stored attendance map, so the client can refresh its cached copy. */
  attendance?: Record<string, boolean>;
}

/** Items per flush request. Small enough to survive a flaky uplink in one go. */
export const OUTBOX_BATCH_SIZE = 50;

/**
 * Queue a save, coalescing with any pending marks for the same ticket.
 * Later values win per date key — exactly the server's `||` merge.
 */
export function enqueueOutbox(
  entries: OutboxEntry[],
  orderId: string,
  patch: Record<string, boolean>,
  now: number,
): OutboxEntry[] {
  if (Object.keys(patch).length === 0) return entries;
  const idx = entries.findIndex((e) => e.orderId === orderId);
  if (idx === -1) return [...entries, { orderId, patch: { ...patch }, queuedAt: now, tries: 0 }];
  return entries.map((e, i) =>
    i === idx ? { ...e, patch: { ...e.patch, ...patch } } : e,
  );
}

/** Drop entries by orderId (acked by the server, or discarded). */
export function dropEntries(entries: OutboxEntry[], orderIds: readonly string[]): OutboxEntry[] {
  if (orderIds.length === 0) return entries;
  const drop = new Set(orderIds);
  return entries.filter((e) => !drop.has(e.orderId));
}

/**
 * Fold a batch response back into the queue.
 *
 * - `ok` → the server has it; drop.
 * - `not_found`/`invalid` → there is nothing to retry (archive row, typo'd id
 *   scanned offline); drop and report, so the UI can say so instead of
 *   retrying forever.
 * - `server` error or a missing result → keep, tries+1.
 */
export function applyBatchResults(
  entries: OutboxEntry[],
  results: BatchItemResult[],
): { entries: OutboxEntry[]; dropped: string[] } {
  const byId = new Map(results.map((r) => [r.orderId, r]));
  const dropped: string[] = [];
  const next: OutboxEntry[] = [];
  for (const e of entries) {
    const r = byId.get(e.orderId);
    if (!r) {
      // Not in this batch (over the batch-size cap) — untouched.
      next.push(e);
      continue;
    }
    if (r.ok || r.error === 'not_found' || r.error === 'invalid') {
      dropped.push(e.orderId);
    } else {
      next.push({ ...e, tries: e.tries + 1 });
    }
  }
  return { entries: next, dropped };
}

/** Parse persisted state. Garbage in → empty queue, never a throw. */
export function parseOutbox(raw: string | null | undefined): OutboxEntry[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: OutboxEntry[] = [];
    for (const item of parsed) {
      if (
        typeof item !== 'object' ||
        item === null ||
        typeof (item as { orderId?: unknown }).orderId !== 'string' ||
        typeof (item as { patch?: unknown }).patch !== 'object' ||
        (item as { patch?: unknown }).patch === null ||
        Array.isArray((item as { patch?: unknown }).patch)
      ) {
        continue;
      }
      const patch: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(
        (item as { patch: Record<string, unknown> }).patch,
      )) {
        if (typeof v === 'boolean') patch[k] = v;
      }
      if (Object.keys(patch).length === 0) continue;
      const queuedAt = (item as { queuedAt?: unknown }).queuedAt;
      const tries = (item as { tries?: unknown }).tries;
      out.push({
        orderId: (item as { orderId: string }).orderId,
        patch,
        queuedAt: typeof queuedAt === 'number' && Number.isFinite(queuedAt) ? queuedAt : Date.now(),
        tries: typeof tries === 'number' && tries >= 0 ? Math.floor(tries) : 0,
      });
    }
    return out;
  } catch {
    return [];
  }
}

export function serializeOutbox(entries: OutboxEntry[]): string {
  return JSON.stringify(entries);
}

/** Minimal fetch surface, so tests can stub it without a Request object. */
export type PostFn = (
  url: string,
  body: string,
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/**
 * Push the head of the queue to the batch endpoint.
 *
 * Returns the decoded results plus whether the server was reached at all — a
 * transport failure means "still offline", and every entry stays queued. A
 * non-2xx with valid JSON is still a reached server; per-item results decide.
 */
export async function pushOutboxBatch(
  entries: OutboxEntry[],
  post: PostFn,
): Promise<{ results: BatchItemResult[]; reachedServer: boolean }> {
  const head = entries.slice(0, OUTBOX_BATCH_SIZE);
  const updates: BatchUpdate[] = head.map((e) => ({ orderId: e.orderId, attendance: e.patch }));
  let res: { ok: boolean; status: number; json: () => Promise<unknown> };
  try {
    res = await post('/api/verify/batch', JSON.stringify({ updates }));
  } catch {
    return { results: [], reachedServer: false };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { results: [], reachedServer: true };
  }
  const results =
    typeof body === 'object' && body !== null && Array.isArray((body as { results?: unknown }).results)
      ? ((body as { results: BatchItemResult[] }).results.filter(
          (r) => typeof r?.orderId === 'string',
        ) as BatchItemResult[])
      : [];
  return { results, reachedServer: true };
}
