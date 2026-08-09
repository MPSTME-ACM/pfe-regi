import { db } from '@/lib/db';
import { registrations, tracks, type Track } from '@/lib/db/schema';
import { and, eq, gt, inArray, or, sql } from 'drizzle-orm';
import type { Sku } from '@/lib/pricing/resolvePrice';

/**
 * Which tracks a given selection consumes a seat in.
 *
 * A bundle decrements THREE counters — a beginner track, an advanced track, and
 * capstone — which is why the capacity check has to be transactional. Checking
 * three counters non-atomically is three chances to oversell.
 */
export const CAPSTONE_SLUG = 'capstone';

/** Statuses that permanently occupy a seat. */
export const OCCUPYING_STATUSES = ['success', 'comped'] as const;

/**
 * How long a `pending` registration holds its seat.
 *
 * This window is what actually prevents overselling, and it is easy to get
 * wrong. Counting only success+comped is not enough: two buyers at capacity-1
 * both pass the check (their own rows are still `pending` and invisible), both
 * pay, and both webhooks flip to `success`. The row lock cannot help, because
 * there is nothing for it to see.
 *
 * Counting `pending` forever is the opposite failure: every abandoned checkout
 * permanently burns a seat, and a closed Cashfree modal fires no webhook at all,
 * so nothing ever releases it.
 *
 * A recent pending row holds its seat; a stale one does not. 30 minutes is
 * comfortably longer than a checkout and short enough that a walked-away
 * browser frees the place on its own.
 */
export const PENDING_HOLD_MINUTES = 30;

/** Rows currently occupying a seat: settled, or pending inside the hold window. */
function occupiesSeat() {
  return or(
    inArray(registrations.paymentStatus, [...OCCUPYING_STATUSES]),
    and(
      eq(registrations.paymentStatus, 'pending'),
      gt(registrations.createdAt, sql`now() - make_interval(mins => ${PENDING_HOLD_MINUTES})`),
    ),
  );
}

export interface TrackSelection {
  sku: Sku;
  beginnerTrack: Track | null;
  advancedTrack: Track | null;
  capstoneTrack: Track | null;
}

export const SKUS: Sku[] = ['capstone', 'single', 'bundle'];

/**
 * Resolve a requested SKU + track slugs into the tracks that must be reserved,
 * or a rejection message.
 *
 * Shared by the public checkout and the member comp route so the two can never
 * disagree about what a bundle contains. `capstone` must NOT carry tracks and
 * `bundle` must carry both — accepting a mismatched payload would let someone
 * pay the bundle price and silently receive no seats.
 */
export function resolveSelection(
  sku: Sku,
  beginnerSlug: string | null | undefined,
  advancedSlug: string | null | undefined,
  bySlug: Map<string, Track>,
): TrackSelection | string {
  const capstoneTrack = bySlug.get(CAPSTONE_SLUG) ?? null;

  if (sku === 'capstone') {
    if (beginnerSlug || advancedSlug) return 'The capstone day does not include a track';
    if (!capstoneTrack?.enabled) return 'The capstone day is not available';
    return { sku, beginnerTrack: null, advancedTrack: null, capstoneTrack };
  }

  if (sku === 'single') {
    if (beginnerSlug && advancedSlug) return 'A single track means one track, not two';
    const slug = beginnerSlug || advancedSlug;
    if (!slug) return 'Choose a track';
    const track = bySlug.get(slug);
    if (!track?.enabled || track.segment === 'capstone') return 'That track is not available';
    return {
      sku,
      beginnerTrack: track.segment === 'beginner' ? track : null,
      advancedTrack: track.segment === 'advanced' ? track : null,
      capstoneTrack: null,
    };
  }

  if (!beginnerSlug || !advancedSlug) return 'A bundle needs one beginner and one advanced track';
  const beginner = bySlug.get(beginnerSlug);
  const advanced = bySlug.get(advancedSlug);
  if (!beginner?.enabled || beginner.segment !== 'beginner') return 'Choose a valid beginner track';
  if (!advanced?.enabled || advanced.segment !== 'advanced') return 'Choose a valid advanced track';
  if (!capstoneTrack?.enabled) return 'The capstone day is not available';
  return { sku, beginnerTrack: beginner, advancedTrack: advanced, capstoneTrack };
}

/** Every track this selection needs a seat in, de-duplicated. */
export function tracksToReserve(sel: TrackSelection): Track[] {
  const out: Track[] = [];
  if (sel.beginnerTrack) out.push(sel.beginnerTrack);
  if (sel.advancedTrack) out.push(sel.advancedTrack);
  if (sel.capstoneTrack) out.push(sel.capstoneTrack);
  return out;
}

/** All the dates a selection entitles the holder to attend, sorted. */
export function entitledDates(sel: TrackSelection): string[] {
  const set = new Set<string>();
  for (const t of tracksToReserve(sel)) for (const d of t.dates) set.add(d);
  return [...set].sort();
}

/** A fresh, all-false attendance map keyed by the dates they actually bought. */
export function initialAttendance(sel: TrackSelection): Record<string, boolean> {
  return Object.fromEntries(entitledDates(sel).map((d) => [d, false]));
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Seats sold per track id, in ONE grouped query.
 *
 * Deliberately not a count() per track in a loop — that mistake is already in
 * this codebase twice (api/stats, the old api/domain-count) and it turns seven
 * tracks into seven round trips.
 */
export async function soldPerTrack(
  runner: Tx | typeof db,
  trackIds: number[],
): Promise<Map<number, number>> {
  const sold = new Map<number, number>(trackIds.map((id) => [id, 0]));
  if (trackIds.length === 0) return sold;

  // A registration can occupy a beginner track AND an advanced track, so the two
  // columns are counted separately and summed into the same map. One grouped
  // query per column — two round trips total, regardless of how many tracks.
  const occupied = occupiesSeat();

  const [beginnerRows, advancedRows] = await Promise.all([
    runner
      .select({ trackId: registrations.beginnerTrackId, n: sql<number>`count(*)::int` })
      .from(registrations)
      .where(and(occupied, inArray(registrations.beginnerTrackId, trackIds)))
      .groupBy(registrations.beginnerTrackId),
    runner
      .select({ trackId: registrations.advancedTrackId, n: sql<number>`count(*)::int` })
      .from(registrations)
      .where(and(occupied, inArray(registrations.advancedTrackId, trackIds)))
      .groupBy(registrations.advancedTrackId),
  ]);

  for (const row of [...beginnerRows, ...advancedRows]) {
    if (row.trackId == null) continue;
    sold.set(row.trackId, (sold.get(row.trackId) ?? 0) + Number(row.n));
  }
  return sold;
}

/** Seats sold for the capstone day, which is tracked by a boolean not an FK. */
export async function soldCapstone(runner: Tx | typeof db): Promise<number> {
  const [row] = await runner
    .select({ n: sql<number>`count(*)::int` })
    .from(registrations)
    .where(and(eq(registrations.hasCapstone, true), occupiesSeat()));
  return Number(row?.n ?? 0);
}

/** Public availability for the form: every enabled track plus whether it is full. */
export async function trackAvailability() {
  const all = await db.select().from(tracks).where(eq(tracks.enabled, true)).orderBy(tracks.sortOrder);
  const ids = all.filter((t) => t.slug !== CAPSTONE_SLUG).map((t) => t.id);
  const sold = await soldPerTrack(db, ids);
  const capstoneSold = await soldCapstone(db);

  return all.map((t) => {
    const used = t.slug === CAPSTONE_SLUG ? capstoneSold : (sold.get(t.id) ?? 0);
    return {
      id: t.id,
      slug: t.slug,
      name: t.name,
      segment: t.segment,
      dates: t.dates,
      full: used >= t.capacity,
    };
  });
}
