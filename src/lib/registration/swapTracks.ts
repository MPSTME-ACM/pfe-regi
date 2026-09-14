import type { Track } from '@/lib/db/schema';
import type { Sku } from '@/lib/pricing/resolvePrice';

// ─────────────────────────────────────────────────────────────────────────────
// The swap planner.
//
// Tracks-after-payment requests ("Web Dev + DSA → Python + AI") are safe to
// honour only when they cannot change what was paid. This module decides that
// purely, so the API route and its confirmation UI can never disagree, and so
// every rule here is exhaustively testable without a database.
//
// Price-neutral by construction, the same way scripts/swap_tracks.py is: the
// plan may only write beginner_track_id / advanced_track_id / attendance. There
// is no field in SwapPlan for sku, has_capstone or amount_paid — a ₹500 bundle
// stays a ₹500 bundle, and "change what was bought" needs a refund/top-up story
// that is deliberately a separate feature.
//
// Deliberately does NOT import @/lib/registration/capacity: that module opens
// the pg pool at import time and this file's tests must stay pure. The two
// constants below duplicate it on purpose.
// ─────────────────────────────────────────────────────────────────────────────

const CAPSTONE_SLUG = 'capstone';

export type SwapSlot = 'beginner' | 'advanced';

export type SwapRejection =
  | 'UNKNOWN_TRACK'
  | 'DISABLED_TRACK'
  | 'SEGMENT_MISMATCH'
  | 'EMPTY_SLOT'
  | 'NO_SLOTS'
  | 'NOTHING_REQUESTED'
  | 'NO_CHANGE';

export const SWAP_REJECTION_MESSAGES: Record<SwapRejection, string> = {
  UNKNOWN_TRACK: 'That track does not exist.',
  DISABLED_TRACK: 'That track is not available.',
  SEGMENT_MISMATCH:
    'The replacement must be the same kind of track as the one it replaces — swapping across kinds would change what was bought.',
  EMPTY_SLOT: 'This registration does not include that kind of track.',
  NO_SLOTS: 'A capstone-only registration has no tracks to swap.',
  NOTHING_REQUESTED: 'Pick a new track first.',
  NO_CHANGE: 'They are already on those tracks.',
};

/** What a route needs to hand the planner: the row's ownership fields. */
export interface SwapRow {
  sku: Sku;
  beginnerTrackId: number | null;
  advancedTrackId: number | null;
  hasCapstone: boolean;
  attendance: Record<string, boolean> | null;
}

/** Slot → requested replacement. A missing key means "leave this slot alone". */
export type SwapRequest = Partial<{ beginnerTrackId: number; advancedTrackId: number }>;

/** Only ever these three fields. Nothing else is writable through a swap. */
export interface SwapPlan {
  beginnerTrackId?: number;
  advancedTrackId?: number;
  /** The FULL merged map to store: existing keys preserved, new dates added false. */
  attendance: Record<string, boolean>;
  /** Dates the new selection added, sorted — shown in the confirmation UI. */
  addedDates: string[];
  /** "Web Dev + DSA + Capstone Day" style, before and after. */
  before: string;
  after: string;
}

/** Every date the final selection entitles the holder to, sorted. */
export function entitledDatesFor(
  beginner: Track | null,
  advanced: Track | null,
  hasCapstone: boolean,
  capstone: Track | null,
): string[] {
  const set = new Set<string>();
  for (const t of [beginner, advanced, hasCapstone ? capstone : null]) {
    for (const d of t?.dates ?? []) set.add(d);
  }
  return [...set].sort();
}

/**
 * Merge the new entitlement into the stored attendance map.
 *
 * Existing keys are preserved verbatim — TRUE ones especially. Losing a recorded
 * attendance is worse than carrying a key nobody renders (see lookupTicket.ts),
 * so nothing is ever deleted, only added. Adding is `false`: a new day starts
 * unticked, the door ticks it.
 */
export function mergedAttendance(
  existing: Record<string, boolean> | null,
  dates: string[],
): { attendance: Record<string, boolean>; added: string[] } {
  const attendance = { ...(existing ?? {}) };
  const added: string[] = [];
  for (const d of dates) {
    if (!(d in attendance)) {
      attendance[d] = false;
      added.push(d);
    }
  }
  return { attendance, added: added.sort() };
}

function describe(
  beginner: Track | null,
  advanced: Track | null,
  hasCapstone: boolean,
  capstone: Track | null,
): string {
  const names: string[] = [];
  for (const t of [beginner, advanced, hasCapstone ? capstone : null]) {
    if (t) names.push(t.name);
  }
  return names.join(' + ') || '(no tracks)';
}

/**
 * Validate a requested swap and produce the write plan.
 *
 * Checked in order, each rejection a different bug: the slot must exist on this
 * SKU (EMPTY_SLOT / NO_SLOTS), the target must be a real, enabled track of the
 * SAME segment as the slot it fills (SEGMENT_MISMATCH is the price-neutral
 * invariant), and the request must actually change something (NO_CHANGE) — the
 * confirmation screen should never offer a diff of "before → before".
 *
 * The segment rule also makes a self-counting capacity check impossible: a
 * target in this slot's segment can never be a track the row already occupies
 * through the other slot, whose segment is different.
 */
export function planSwap(
  row: SwapRow,
  tracks: Track[],
  request: SwapRequest,
): { ok: true; plan: SwapPlan } | { ok: false; rejection: SwapRejection; trackName?: string } {
  const byId = new Map(tracks.map((t) => [t.id, t]));

  if (row.sku === 'capstone') {
    return { ok: false, rejection: 'NO_SLOTS' };
  }

  const requested = (['beginnerTrackId', 'advancedTrackId'] as const).filter(
    (slot) => request[slot] !== undefined,
  );
  if (requested.length === 0) {
    return { ok: false, rejection: 'NOTHING_REQUESTED' };
  }

  // A bundle owns both slots; a single owns exactly one, and the planner cannot
  // tell which without the tracks — so validate against the slot being changed.
  const canFillSlot = (slot: SwapSlot) => row[slot === 'beginner' ? 'beginnerTrackId' : 'advancedTrackId'] !== null;

  const changes: Partial<{ beginnerTrackId: number; advancedTrackId: number }> = {};
  for (const slot of requested) {
    const segment = slot === 'beginnerTrackId' ? 'beginner' : 'advanced';
    if (!canFillSlot(segment)) {
      return { ok: false, rejection: 'EMPTY_SLOT' };
    }
    const target = byId.get(request[slot]!);
    if (!target) return { ok: false, rejection: 'UNKNOWN_TRACK' };
    if (!target.enabled) {
      return { ok: false, rejection: 'DISABLED_TRACK', trackName: target.name };
    }
    if (target.segment !== segment) {
      return { ok: false, rejection: 'SEGMENT_MISMATCH', trackName: target.name };
    }
    changes[slot] = target.id;
  }

  const currentBeginner = row.beginnerTrackId === null ? null : (byId.get(row.beginnerTrackId) ?? null);
  const currentAdvanced = row.advancedTrackId === null ? null : (byId.get(row.advancedTrackId) ?? null);
  const capstoneTrack = tracks.find((t) => t.slug === CAPSTONE_SLUG) ?? null;

  const newBeginner = changes.beginnerTrackId !== undefined
    ? (byId.get(changes.beginnerTrackId) ?? null)
    : currentBeginner;
  const newAdvanced = changes.advancedTrackId !== undefined
    ? (byId.get(changes.advancedTrackId) ?? null)
    : currentAdvanced;

  // A requested slot that names the track already there changes nothing. Compare
  // resolved tracks, not the request object: an untouched slot is absent from
  // `changes`, so comparing `changes.x === row.x` would call a half-request a
  // no-op the moment the other slot were undefined.
  if (
    (newBeginner?.id ?? null) === (row.beginnerTrackId ?? null) &&
    (newAdvanced?.id ?? null) === (row.advancedTrackId ?? null)
  ) {
    return { ok: false, rejection: 'NO_CHANGE' };
  }

  const dates = entitledDatesFor(newBeginner, newAdvanced, row.hasCapstone, capstoneTrack);
  const { attendance, added } = mergedAttendance(row.attendance, dates);

  return {
    ok: true,
    plan: {
      ...changes,
      attendance,
      addedDates: added,
      before: describe(currentBeginner, currentAdvanced, row.hasCapstone, capstoneTrack),
      after: describe(newBeginner, newAdvanced, row.hasCapstone, capstoneTrack),
    },
  };
}
