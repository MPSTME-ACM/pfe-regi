import { describe, it, expect } from 'vitest';
import {
  enqueueOutbox,
  dropEntries,
  applyBatchResults,
  parseOutbox,
  serializeOutbox,
  pushOutboxBatch,
  OUTBOX_BATCH_SIZE,
  type OutboxEntry,
  type BatchItemResult,
} from './outbox';

/**
 * The outbox is what stands between a volunteer's tap and the database when
 * the college network drops. It is pure, so every merge and flush rule is
 * pinned here — a wrong answer silently loses attendance marks.
 */
describe('enqueueOutbox', () => {
  it('queues a fresh entry', () => {
    const next = enqueueOutbox([], 'ORD1', { '2026-09-17': true }, 1000);
    expect(next).toEqual([{ orderId: 'ORD1', patch: { '2026-09-17': true }, queuedAt: 1000, tries: 0 }]);
  });

  it('coalesces repeat marks on one ticket, latest value per day winning', () => {
    // Matches the server's jsonb `||` merge: replaying the coalesced patch
    // writes the same bytes as replaying each mark in order.
    let entries: OutboxEntry[] = [];
    entries = enqueueOutbox(entries, 'ORD1', { '2026-09-17': true }, 1000);
    entries = enqueueOutbox(entries, 'ORD1', { '2026-09-18': true }, 2000);
    entries = enqueueOutbox(entries, 'ORD1', { '2026-09-17': false }, 3000);
    expect(entries).toHaveLength(1);
    expect(entries[0].patch).toEqual({ '2026-09-17': false, '2026-09-18': true });
    // Age is reported from the first unsynced mark, not the latest tap.
    expect(entries[0].queuedAt).toBe(1000);
  });

  it('keeps other tickets separate', () => {
    let entries: OutboxEntry[] = [];
    entries = enqueueOutbox(entries, 'A', { d1: true }, 1);
    entries = enqueueOutbox(entries, 'B', { d1: true }, 2);
    expect(entries).toHaveLength(2);
  });

  it('ignores an empty patch', () => {
    expect(enqueueOutbox([], 'A', {}, 1)).toEqual([]);
  });
});

describe('dropEntries', () => {
  it('removes exactly the acked ids', () => {
    const entries: OutboxEntry[] = [
      { orderId: 'A', patch: { d: true }, queuedAt: 1, tries: 0 },
      { orderId: 'B', patch: { d: true }, queuedAt: 1, tries: 0 },
    ];
    expect(dropEntries(entries, ['A'])).toHaveLength(1);
    expect(dropEntries(entries, ['A'])[0].orderId).toBe('B');
  });
});

describe('applyBatchResults', () => {
  const entry = (orderId: string): OutboxEntry => ({ orderId, patch: { d: true }, queuedAt: 1, tries: 0 });

  it('drops acked entries', () => {
    const { entries, dropped } = applyBatchResults([entry('A'), entry('B')], [
      { orderId: 'A', ok: true },
    ]);
    // B was over the batch-size cap and untouched — not dropped, not failed.
    expect(entries.map((e) => e.orderId)).toEqual(['B']);
    expect(entries[0].tries).toBe(0);
    expect(dropped).toEqual(['A']);
  });

  it('drops not_found so a bad id cannot retry forever', () => {
    const { entries, dropped } = applyBatchResults([entry('A')], [
      { orderId: 'A', ok: false, error: 'not_found' },
    ]);
    expect(entries).toEqual([]);
    expect(dropped).toEqual(['A']);
  });

  it('keeps server failures queued with tries bumped', () => {
    const { entries, dropped } = applyBatchResults([entry('A')], [
      { orderId: 'A', ok: false, error: 'server' },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].tries).toBe(1);
    expect(dropped).toEqual([]);
  });
});

describe('parseOutbox', () => {
  it('round-trips through serialize', () => {
    const entries = enqueueOutbox([], 'A', { d: true }, 5);
    expect(parseOutbox(serializeOutbox(entries))).toEqual(entries);
  });

  it('returns empty for null, garbage and wrong shapes', () => {
    expect(parseOutbox(null)).toEqual([]);
    expect(parseOutbox('not json')).toEqual([]);
    expect(parseOutbox('{"a":1}')).toEqual([]);
    expect(parseOutbox(JSON.stringify([{ orderId: 42 }]))).toEqual([]);
  });

  it('keeps valid entries and drops corrupt ones, coercing only booleans', () => {
    const raw = JSON.stringify([
      { orderId: 'A', patch: { d1: true, d2: 'yes' }, queuedAt: 7, tries: 2 },
      { orderId: 'B', patch: {} },
    ]);
    expect(parseOutbox(raw)).toEqual([
      { orderId: 'A', patch: { d1: true }, queuedAt: 7, tries: 2 },
    ]);
  });
});

describe('pushOutboxBatch', () => {
  const entry = (orderId: string): OutboxEntry => ({ orderId, patch: { d: true }, queuedAt: 1, tries: 0 });

  it('posts at most OUTBOX_BATCH_SIZE updates', async () => {
    const entries = Array.from({ length: OUTBOX_BATCH_SIZE + 5 }, (_, i) => entry(`O${i}`));
    let sent = 0;
    const results: BatchItemResult[] = entries.slice(0, OUTBOX_BATCH_SIZE).map((e) => ({ orderId: e.orderId, ok: true }));
    const { reachedServer } = await pushOutboxBatch(entries, async () => {
      sent += 1;
      return { ok: true, status: 200, json: async () => ({ success: true, results }) };
    });
    expect(sent).toBe(1);
    expect(reachedServer).toBe(true);
  });

  it('reports unreachable on transport failure, keeping everything queued', async () => {
    const { results, reachedServer } = await pushOutboxBatch([entry('A')], async () => {
      throw new Error('offline');
    });
    expect(reachedServer).toBe(false);
    expect(results).toEqual([]);
  });

  it('treats an undecodable body as reached-but-empty', async () => {
    const { reachedServer, results } = await pushOutboxBatch([entry('A')], async () => ({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('no json');
      },
    }));
    expect(reachedServer).toBe(true);
    expect(results).toEqual([]);
  });
});
