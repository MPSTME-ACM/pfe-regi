// ─────────────────────────────────────────────────────────────────────────────
// Spec tests for the swap planner.
//
// Written against the SPEC, not the implementation, like resolvePrice.test.ts:
// every expected attendance map is a hand-written literal, never re-derived from
// mergedAttendance(). Track fixtures are hand-built objects — this suite must
// stay pure, so nothing imports @/lib/registration/capacity (it opens the pg
// pool at import time).
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';

import {
  mergedAttendance,
  planSwap,
  type SwapRow,
} from '@/lib/registration/swapTracks';
import type { Track } from '@/lib/db/schema';

// ─── fixtures ────────────────────────────────────────────────────────────────

let nextId = 1;
/** Hand-built track. `id` must be unique so fixtures never alias each other. */
function track(overrides: Partial<Track> & Pick<Track, 'slug' | 'name' | 'segment'>): Track {
  return {
    id: nextId++,
    dates: [],
    capacity: 120,
    enabled: true,
    sortOrder: 0,
    ...overrides,
  };
}

const PY = track({ slug: 'python', name: 'Python', segment: 'beginner', dates: ['2026-09-16', '2026-09-17'] });
const WEB = track({ slug: 'webdev', name: 'Web Dev', segment: 'beginner', dates: ['2026-09-16', '2026-09-17'] });
const DSA = track({ slug: 'dsa', name: 'DSA', segment: 'advanced', dates: ['2026-09-18', '2026-09-19'] });
const AI = track({ slug: 'ai', name: 'AI', segment: 'advanced', dates: ['2026-09-18', '2026-09-19'] });
const CYBER = track({ slug: 'cybersecurity', name: 'Cybersecurity', segment: 'advanced', dates: ['2026-09-20', '2026-09-21'] });
const CAP = track({ slug: 'capstone', name: 'Capstone Day', segment: 'capstone', dates: ['2026-09-22'] });
const OFF = track({ slug: 'retired', name: 'Retired Track', segment: 'advanced', enabled: false, dates: ['2026-09-18'] });

/** id order matters for nothing in the planner — pass them in display order. */
const TRACKS = [PY, WEB, DSA, AI, CYBER, CAP, OFF];

const ALL = () => TRACKS;

/** A ₹500 bundle: one beginner + one advanced + capstone, nothing attended yet. */
function bundle(overrides: Partial<SwapRow> = {}): SwapRow {
  return {
    sku: 'bundle',
    beginnerTrackId: WEB.id,
    advancedTrackId: DSA.id,
    hasCapstone: true,
    attendance: {
      '2026-09-16': false,
      '2026-09-17': true,
      '2026-09-18': false,
      '2026-09-19': false,
      '2026-09-22': false,
    },
    ...overrides,
  };
}

// ─── rejections ──────────────────────────────────────────────────────────────

describe('planSwap — the request must be about something', () => {
  it('rejects an empty request', () => {
    expect(planSwap(bundle(), ALL(), {})).toEqual({ ok: false, rejection: 'NOTHING_REQUESTED' });
  });

  it('rejects a capstone-only registration outright', () => {
    expect(
      planSwap(
        { sku: 'capstone', beginnerTrackId: null, advancedTrackId: null, hasCapstone: true, attendance: {} },
        ALL(),
        { beginnerTrackId: PY.id },
      ),
    ).toEqual({ ok: false, rejection: 'NO_SLOTS' });
  });

  it('rejects a no-op before computing any attendance', () => {
    expect(
      planSwap(bundle(), ALL(), { beginnerTrackId: WEB.id, advancedTrackId: DSA.id }),
    ).toEqual({ ok: false, rejection: 'NO_CHANGE' });
  });

  it('rejects a no-op on one slot even though the other slot also matched', () => {
    expect(planSwap(bundle(), ALL(), { beginnerTrackId: WEB.id })).toEqual({
      ok: false,
      rejection: 'NO_CHANGE',
    });
  });
});

describe('planSwap — the target must be real, enabled and in-segment', () => {
  it('rejects an unknown track id', () => {
    expect(planSwap(bundle(), ALL(), { beginnerTrackId: 99999 })).toEqual({
      ok: false,
      rejection: 'UNKNOWN_TRACK',
    });
  });

  it('rejects a disabled target, naming it', () => {
    expect(planSwap(bundle(), ALL(), { advancedTrackId: OFF.id })).toEqual({
      ok: false,
      rejection: 'DISABLED_TRACK',
      trackName: 'Retired Track',
    });
  });

  it('rejects a beginner track offered for the advanced slot', () => {
    expect(planSwap(bundle(), ALL(), { advancedTrackId: PY.id })).toEqual({
      ok: false,
      rejection: 'SEGMENT_MISMATCH',
      trackName: 'Python',
    });
  });

  it('rejects an advanced track offered for the beginner slot', () => {
    expect(planSwap(bundle(), ALL(), { beginnerTrackId: AI.id })).toEqual({
      ok: false,
      rejection: 'SEGMENT_MISMATCH',
      trackName: 'AI',
    });
  });

  it('never lets the capstone be "swapped into" a track slot', () => {
    expect(planSwap(bundle(), ALL(), { beginnerTrackId: CAP.id })).toEqual({
      ok: false,
      rejection: 'SEGMENT_MISMATCH',
      trackName: 'Capstone Day',
    });
  });
});

describe('planSwap — what was bought cannot change', () => {
  it('refuses to fill an empty advanced slot on a single-track registration', () => {
    // A single buyer paid for one track. Adding a second one is a top-up, not a swap.
    expect(
      planSwap(
        {
          sku: 'single',
          beginnerTrackId: PY.id,
          advancedTrackId: null,
          hasCapstone: false,
          attendance: { '2026-09-16': false, '2026-09-17': false },
        },
        ALL(),
        { advancedTrackId: AI.id },
      ),
    ).toEqual({ ok: false, rejection: 'EMPTY_SLOT' });
  });

  it('refuses to fill an empty beginner slot on a single-track registration', () => {
    expect(
      planSwap(
        {
          sku: 'single',
          beginnerTrackId: null,
          advancedTrackId: AI.id,
          hasCapstone: false,
          attendance: {},
        },
        ALL(),
        { beginnerTrackId: PY.id },
      ),
    ).toEqual({ ok: false, rejection: 'EMPTY_SLOT' });
  });

  it('allows replacing the one track a single registration owns, in its own segment', () => {
    const result = planSwap(
      {
        sku: 'single',
        beginnerTrackId: null,
        advancedTrackId: AI.id,
        hasCapstone: false,
        attendance: { '2026-09-18': false, '2026-09-19': true },
      },
      ALL(),
      { advancedTrackId: CYBER.id },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.advancedTrackId).toBe(CYBER.id);
    expect(result.plan.beginnerTrackId).toBeUndefined();
    expect(result.plan.before).toBe('AI');
    expect(result.plan.after).toBe('Cybersecurity');
  });
});

// ─── the plan itself ─────────────────────────────────────────────────────────

describe('planSwap — the happy bundle swap', () => {
  const result = planSwap(bundle(), ALL(), { beginnerTrackId: PY.id, advancedTrackId: AI.id });

  it('writes both slots and nothing else', () => {
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.beginnerTrackId).toBe(PY.id);
    expect(result.plan.advancedTrackId).toBe(AI.id);
    // The plan type cannot carry sku / hasCapstone / amountPaid — assert the
    // object really has only what a track swap is allowed to write.
    expect(Object.keys(result.plan).sort()).toEqual([
      'addedDates', 'advancedTrackId', 'after', 'attendance', 'before', 'beginnerTrackId',
    ]);
  });

  it('describes before and after in programme order, capstone last', () => {
    if (!result.ok) return expect.fail();
    expect(result.plan.before).toBe('Web Dev + DSA + Capstone Day');
    expect(result.plan.after).toBe('Python + AI + Capstone Day');
  });

  it('adds no attendance keys when the new tracks run the same five days', () => {
    if (!result.ok) return expect.fail();
    expect(result.plan.addedDates).toEqual([]);
    // Same dates, so the merge must hand back the row's map untouched — the
    // '2026-09-17': true mark survives byte for byte.
    expect(result.plan.attendance).toEqual({
      '2026-09-16': false,
      '2026-09-17': true,
      '2026-09-18': false,
      '2026-09-19': false,
      '2026-09-22': false,
    });
  });

  it('keeps a recorded TRUE through the swap', () => {
    if (!result.ok) return expect.fail();
    expect(result.plan.attendance['2026-09-17']).toBe(true);
  });
});

describe('planSwap — attendance follows the new tracks', () => {
  it('adds keys for days the replacement tracks run on', () => {
    // Cybersecurity runs 20–21 instead of DSA's 18–19: two new days.
    const result = planSwap(bundle(), ALL(), { advancedTrackId: CYBER.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.addedDates).toEqual(['2026-09-20', '2026-09-21']);
    expect(result.plan.attendance).toEqual({
      '2026-09-16': false,
      '2026-09-17': true,
      // Stale 18/19 keys stay — never deleted.
      '2026-09-18': false,
      '2026-09-19': false,
      '2026-09-22': false,
      '2026-09-20': false,
      '2026-09-21': false,
    });
  });

  it('leaves attendance alone when a single swaps onto a track with the same dates', () => {
    const same = track({ slug: 'webdev2', name: 'Web Dev II', segment: 'beginner', dates: ['2026-09-16', '2026-09-17'] });
    const result = planSwap(
      {
        sku: 'single',
        beginnerTrackId: PY.id,
        advancedTrackId: null,
        hasCapstone: false,
        attendance: { '2026-09-16': true, '2026-09-17': false },
      },
      [...ALL(), same],
      { beginnerTrackId: same.id },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.addedDates).toEqual([]);
    expect(result.plan.attendance).toEqual({ '2026-09-16': true, '2026-09-17': false });
  });

  it('merges into a null attendance map without special cases', () => {
    const result = planSwap(
      {
        sku: 'single',
        beginnerTrackId: PY.id,
        advancedTrackId: null,
        hasCapstone: false,
        attendance: null,
      },
      ALL(),
      { beginnerTrackId: WEB.id },
    );
    // PY → WEB is a genuine change (different ids), so it plans. The row carried
    // NO attendance keys at all, so both of WEB's dates are genuinely new —
    // the null-map merge is what this test really checks.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.addedDates).toEqual(['2026-09-16', '2026-09-17']);
    expect(result.plan.attendance).toEqual({ '2026-09-16': false, '2026-09-17': false });
  });
});

// ─── mergedAttendance in isolation ───────────────────────────────────────────

describe('mergedAttendance', () => {
  it('adds every new date as false and deletes nothing', () => {
    const { attendance, added } = mergedAttendance(
      { '2026-09-16': true },
      ['2026-09-16', '2026-09-17', '2026-09-22'],
    );
    expect(attendance).toEqual({ '2026-09-16': true, '2026-09-17': false, '2026-09-22': false });
    expect(added).toEqual(['2026-09-17', '2026-09-22']);
  });

  it('returns the map unchanged when every date already has a key', () => {
    const existing = { '2026-09-16': false };
    const { attendance, added } = mergedAttendance(existing, ['2026-09-16']);
    expect(attendance).toEqual({ '2026-09-16': false });
    expect(added).toEqual([]);
  });

  it('treats null as an empty map, not an error', () => {
    const { attendance, added } = mergedAttendance(null, ['2026-09-18']);
    expect(attendance).toEqual({ '2026-09-18': false });
    expect(added).toEqual(['2026-09-18']);
  });
});
