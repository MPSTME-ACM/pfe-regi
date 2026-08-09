import { NextResponse } from 'next/server';
import { and, eq, gt, inArray, isNotNull, sql } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { db } from '@/lib/db';
import { registrations, tracks } from '@/lib/db/schema';
import {
  CAPSTONE_SLUG,
  OCCUPYING_STATUSES,
  PENDING_HOLD_MINUTES,
} from '@/lib/registration/capacity';

export const dynamic = 'force-dynamic';

// ─────────────────────────────────────────────────────────────────────────────
// Admin CRUD over `tracks`.
//
// Read + update only. The seven tracks are seeded by migration 0008 and their
// `slug` is a machine key that `resolveSelection()` and two FK columns depend
// on, so this endpoint deliberately exposes no create and no delete: inventing
// an eighth track or removing one out from under a sold registration are both
// schema-level operations, not panel operations. `slug` and `segment` are not
// writable for the same reason — only the presentation and capacity fields are.
// ─────────────────────────────────────────────────────────────────────────────

/** A track with 10,000 seats is a typo, not a plan. */
const MAX_CAPACITY = 10_000;
const MAX_SORT_ORDER = 9_999;
const MAX_DATES = 14;
const MAX_NAME_LENGTH = 100;

// ─── counting ────────────────────────────────────────────────────────────────

/**
 * Two counts per track, and they mean different things.
 *
 * `sold` is settled headcount — success + comped. That is the number an admin
 * is asking for when they ask how many people are coming.
 *
 * `held` is pending rows still inside PENDING_HOLD_MINUTES: carts in flight.
 * They are invisible to the admin but NOT to the checkout, which counts them
 * (see `occupiesSeat()` in capacity.ts) precisely so two buyers at capacity-1
 * cannot both get through. Showing only `sold` would leave the panel reading
 * "88 / 120, open" while the public form turns buyers away as full, which is
 * the two-places-disagree bug this codebase keeps stepping on. So `full` here
 * is computed the same way trackAvailability() computes it: sold + held.
 *
 * The status constants and the hold window are imported rather than restated —
 * capacity.ts stays the single source of truth for both.
 */
const soldExpr = sql<number>`count(*) filter (where ${inArray(
  registrations.paymentStatus,
  [...OCCUPYING_STATUSES],
)})::int`;

const heldExpr = sql<number>`count(*) filter (where ${and(
  eq(registrations.paymentStatus, 'pending'),
  gt(registrations.createdAt, sql`now() - make_interval(mins => ${PENDING_HOLD_MINUTES})`),
)})::int`;

interface Counts {
  sold: number;
  held: number;
}

/**
 * Seats consumed per track id, plus the capstone day's own tally.
 *
 * Three grouped queries total, not one per track. A count() query per track in
 * a loop is a mistake that already exists twice in this repo (api/stats, the old
 * api/domain-count); seven tracks should not be seven round trips.
 */
async function countSeats(): Promise<{ byTrackId: Map<number, Counts>; capstone: Counts }> {
  const [beginnerRows, advancedRows, capstoneRows] = await Promise.all([
    db
      .select({ trackId: registrations.beginnerTrackId, sold: soldExpr, held: heldExpr })
      .from(registrations)
      .where(isNotNull(registrations.beginnerTrackId))
      .groupBy(registrations.beginnerTrackId),
    db
      .select({ trackId: registrations.advancedTrackId, sold: soldExpr, held: heldExpr })
      .from(registrations)
      .where(isNotNull(registrations.advancedTrackId))
      .groupBy(registrations.advancedTrackId),
    db
      .select({ sold: soldExpr, held: heldExpr })
      .from(registrations)
      .where(eq(registrations.hasCapstone, true)),
  ]);

  const byTrackId = new Map<number, Counts>();
  for (const row of [...beginnerRows, ...advancedRows]) {
    if (row.trackId == null) continue;
    const current = byTrackId.get(row.trackId) ?? { sold: 0, held: 0 };
    byTrackId.set(row.trackId, {
      sold: current.sold + Number(row.sold),
      held: current.held + Number(row.held),
    });
  }

  return {
    byTrackId,
    capstone: {
      sold: Number(capstoneRows[0]?.sold ?? 0),
      held: Number(capstoneRows[0]?.held ?? 0),
    },
  };
}

export interface AdminTrack {
  id: number;
  slug: string;
  name: string;
  segment: 'beginner' | 'advanced' | 'capstone';
  dates: string[];
  capacity: number;
  enabled: boolean;
  sortOrder: number;
  /** Settled headcount: success + comped. */
  sold: number;
  /** Pending checkouts still holding a seat. Released after PENDING_HOLD_MINUTES. */
  held: number;
  /** True when the public form will reject this track. Matches /api/domain-count. */
  full: boolean;
}

async function listTracks(): Promise<AdminTrack[]> {
  // Secondary sort on id: sortOrder collisions are legal, and without a
  // tiebreak the panel reshuffles its own rows between loads.
  const rows = await db.select().from(tracks).orderBy(tracks.sortOrder, tracks.id);
  const { byTrackId, capstone } = await countSeats();

  return rows.map((t) => {
    const counts = t.slug === CAPSTONE_SLUG ? capstone : (byTrackId.get(t.id) ?? { sold: 0, held: 0 });
    return {
      id: t.id,
      slug: t.slug,
      name: t.name,
      segment: t.segment,
      dates: t.dates,
      capacity: t.capacity,
      enabled: t.enabled,
      sortOrder: t.sortOrder,
      sold: counts.sold,
      held: counts.held,
      full: counts.sold + counts.held >= t.capacity,
    };
  });
}

export async function GET(request: Request) {
  const auth = requireAdmin(request);
  if (!auth.ok) return auth.response;

  try {
    return NextResponse.json({
      success: true,
      tracks: await listTracks(),
      pendingHoldMinutes: PENDING_HOLD_MINUTES,
    });
  } catch (error) {
    console.error('[admin/tracks] list failed:', error);
    return NextResponse.json({ success: false, message: 'Failed to load tracks' }, { status: 500 });
  }
}

// ─── validation ──────────────────────────────────────────────────────────────
// Whitelist-only, same rule as api/admin/settings: anything not named here is
// dropped, so a client cannot smuggle in `slug`, `segment`, or a brand new row.

/** Fields an admin may write. `id` selects the row; it is never assigned. */
type TrackPatch = Partial<{
  name: string;
  capacity: number;
  dates: string[];
  enabled: boolean;
  sortOrder: number;
}>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `2026-02-31` matches the regex and is still not a day. */
function isRealDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function parseInteger(
  value: unknown,
  field: string,
  min: number,
  max: number,
  errors: string[],
): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    errors.push(`${field} must be a whole number`);
    return undefined;
  }
  if (value < min || value > max) {
    errors.push(`${field} must be between ${min} and ${max}`);
    return undefined;
  }
  return value;
}

function parseDates(value: unknown, field: string, errors: string[]): string[] | undefined {
  if (!Array.isArray(value) || value.some((d) => typeof d !== 'string')) {
    errors.push(`${field} must be an array of YYYY-MM-DD strings`);
    return undefined;
  }
  const raw = (value as string[]).map((d) => d.trim()).filter(Boolean);
  if (raw.length === 0) {
    errors.push(`${field} needs at least one date — a track with no dates issues a ticket with no days on it`);
    return undefined;
  }
  if (raw.length > MAX_DATES) {
    errors.push(`${field} cannot have more than ${MAX_DATES} dates`);
    return undefined;
  }
  const bad = raw.filter((d) => !isRealDate(d));
  if (bad.length) {
    errors.push(`${field} has invalid dates: ${bad.join(', ')} (expected YYYY-MM-DD)`);
    return undefined;
  }
  // De-duplicated and sorted rather than rejected: entitledDates() already
  // collapses duplicates, so a repeat is harmless — just untidy.
  return [...new Set(raw)].sort();
}

function parseEntry(
  value: unknown,
  index: number,
  errors: string[],
): { id: number; patch: TrackPatch } | undefined {
  const where = `tracks[${index}]`;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    errors.push(`${where} must be an object`);
    return undefined;
  }
  const o = value as Record<string, unknown>;

  const id = parseInteger(o.id, `${where}.id`, 1, Number.MAX_SAFE_INTEGER, errors);
  if (id === undefined) return undefined;

  const errorsBefore = errors.length;
  const patch: TrackPatch = {};

  if (o.name !== undefined) {
    if (typeof o.name !== 'string' || o.name.trim().length === 0) {
      errors.push(`${where}.name must be a non-empty string`);
    } else if (o.name.trim().length > MAX_NAME_LENGTH) {
      errors.push(`${where}.name must be at most ${MAX_NAME_LENGTH} characters`);
    } else {
      patch.name = o.name.trim();
    }
  }
  if (o.capacity !== undefined) {
    const capacity = parseInteger(o.capacity, `${where}.capacity`, 0, MAX_CAPACITY, errors);
    if (capacity !== undefined) patch.capacity = capacity;
  }
  if (o.dates !== undefined) {
    const dates = parseDates(o.dates, `${where}.dates`, errors);
    if (dates !== undefined) patch.dates = dates;
  }
  if (o.enabled !== undefined) {
    if (typeof o.enabled !== 'boolean') errors.push(`${where}.enabled must be a boolean`);
    else patch.enabled = o.enabled;
  }
  if (o.sortOrder !== undefined) {
    const sortOrder = parseInteger(o.sortOrder, `${where}.sortOrder`, 0, MAX_SORT_ORDER, errors);
    if (sortOrder !== undefined) patch.sortOrder = sortOrder;
  }

  if (Object.keys(patch).length === 0) {
    // Only complain about an empty patch when nothing else already did — a
    // rejected field has an empty patch too, and two messages for one mistake
    // reads as two mistakes.
    if (errors.length === errorsBefore) {
      errors.push(`${where} has no editable fields (name, capacity, dates, enabled, sortOrder)`);
    }
    return undefined;
  }
  return { id, patch };
}

function buildPatches(body: unknown): { patches: { id: number; patch: TrackPatch }[] } | { errors: string[] } {
  if (typeof body !== 'object' || body === null) {
    return { errors: ['body must be a JSON object'] };
  }
  const list = (body as Record<string, unknown>).tracks;
  if (!Array.isArray(list)) return { errors: ['body.tracks must be an array'] };
  if (list.length === 0) return { errors: ['body.tracks is empty — nothing to save'] };

  const errors: string[] = [];
  const patches: { id: number; patch: TrackPatch }[] = [];
  const seen = new Set<number>();

  list.forEach((entry, index) => {
    const parsed = parseEntry(entry, index, errors);
    if (!parsed) return;
    if (seen.has(parsed.id)) {
      errors.push(`track id ${parsed.id} appears more than once`);
      return;
    }
    seen.add(parsed.id);
    patches.push(parsed);
  });

  if (errors.length) return { errors };
  return { patches };
}

/** A client-supplied id that is not in the table: a 400, not a 500. */
class UnknownTrackError extends Error {
  readonly ids: number[];
  constructor(ids: number[]) {
    super(`unknown track ids: ${ids.join(', ')}`);
    this.name = 'UnknownTrackError';
    this.ids = ids;
  }
}

export async function PATCH(request: Request) {
  const auth = requireAdmin(request);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: 'Invalid JSON body' }, { status: 400 });
  }

  const result = buildPatches(body);
  if ('errors' in result) {
    return NextResponse.json({ success: false, message: result.errors.join('; ') }, { status: 400 });
  }

  try {
    // One transaction for the whole batch: a partial save would leave the panel
    // showing a state that never existed, e.g. capstone disabled but the bundle
    // tracks still open.
    await db.transaction(async (tx) => {
      const existing = await tx
        .select({ id: tracks.id })
        .from(tracks)
        .where(inArray(tracks.id, result.patches.map((p) => p.id)));
      const known = new Set(existing.map((t) => t.id));
      const unknown = result.patches.filter((p) => !known.has(p.id)).map((p) => p.id);
      if (unknown.length) {
        // Thrown inside the transaction so nothing is written; caught below and
        // translated into a 400 rather than a 500.
        throw new UnknownTrackError(unknown);
      }

      for (const { id, patch } of result.patches) {
        await tx.update(tracks).set(patch).where(eq(tracks.id, id));
      }
    });
  } catch (error) {
    if (error instanceof UnknownTrackError) {
      return NextResponse.json(
        { success: false, message: `unknown track id(s): ${error.ids.join(', ')}` },
        { status: 400 },
      );
    }
    console.error('[admin/tracks] update failed:', error);
    return NextResponse.json({ success: false, message: 'Failed to save tracks' }, { status: 500 });
  }

  try {
    const updated = await listTracks();
    const disabled = updated.filter((t) => !t.enabled).map((t) => t.slug);
    if (disabled.length) console.log(`[admin/tracks] disabled tracks: ${disabled.join(', ')}`);
    return NextResponse.json({ success: true, tracks: updated, pendingHoldMinutes: PENDING_HOLD_MINUTES });
  } catch (error) {
    console.error('[admin/tracks] saved but re-read failed:', error);
    return NextResponse.json({ success: false, message: 'Saved, but reloading the list failed' }, { status: 500 });
  }
}
