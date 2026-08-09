import { db } from '@/lib/db';
import {
  registrations,
  registrations2025,
  tracks,
  type Registration,
  type Track,
} from '@/lib/db/schema';
import { eq, inArray, or } from 'drizzle-orm';
import { CAPSTONE_SLUG, entitledDates, type TrackSelection } from '@/lib/registration/capacity';

// ─────────────────────────────────────────────────────────────────────────────
// One place that turns an orderId into something a screen can render.
//
// Two callers need exactly this and they must not drift: /api/verify (the door
// scanner) and /api/get-status (the post-payment ticket). Both have to cope with
// 2025 QR codes, which are still in circulation and whose rows now live in the
// read-only `pferegistration_2025` archive.
//
// The orderId is OPAQUE. Nothing here parses it — which edition a ticket belongs
// to is decided by which table the row is in, never by the shape of the string.
// ─────────────────────────────────────────────────────────────────────────────

export interface TicketDay {
  /** 2026: the ISO date. 2025: a positional key, because no dates were stored. */
  key: string;
  /** What the door staff reads, e.g. "Thu 17 Sep" or "Day 1". */
  label: string;
  present: boolean;
}

export interface TicketView {
  edition: 2025 | 2026;
  /** Archived registrations are never writable. Attendance cannot be edited. */
  readOnly: boolean;
  name: string;
  orderId: string;
  course: string | null;
  year: string | null;
  department: string | null;
  /** What they bought: resolved track names, or the 2025 `domain`. */
  description: string;
  sku: string | null;
  paymentStatus: string | null;
  qrCodeUrl: string | null;
  /** Exactly the days this registration may be marked present for, in order. */
  days: TicketDay[];
}

export interface TicketLookup {
  view: TicketView;
  /** The live 2026 row. Null for an archived 2025 ticket, which is read-only. */
  row: Registration | null;
}

// Deliberately not toLocaleDateString: the label is generated on the server and
// must not depend on the container's locale or timezone.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "2026-09-17" → "Thu 17 Sep". Falls back to the raw string if it is not a date. */
export function formatDayLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (Number.isNaN(date.getTime())) return iso;
  return `${WEEKDAYS[date.getUTCDay()]} ${Number(d)} ${MONTHS[Number(mo) - 1]}`;
}

/**
 * The tracks a stored registration actually holds, as a `TrackSelection`.
 *
 * `resolveSelection` is for untrusted slugs arriving from a form; this is the
 * other direction — a row that already exists, whose track ids are settled.
 */
async function selectionForRow(row: Registration): Promise<TrackSelection> {
  const ids = [row.beginnerTrackId, row.advancedTrackId].filter((n): n is number => n !== null);

  // One round trip whether or not capstone is involved.
  const filters = [
    ids.length ? inArray(tracks.id, ids) : undefined,
    row.hasCapstone ? eq(tracks.slug, CAPSTONE_SLUG) : undefined,
  ].filter((f): f is NonNullable<typeof f> => f !== undefined);

  const picked: Track[] = filters.length
    ? await db.select().from(tracks).where(filters.length === 1 ? filters[0] : or(...filters))
    : [];

  const byId = new Map(picked.map((t) => [t.id, t]));
  return {
    sku: row.sku,
    beginnerTrack: row.beginnerTrackId ? (byId.get(row.beginnerTrackId) ?? null) : null,
    advancedTrack: row.advancedTrackId ? (byId.get(row.advancedTrackId) ?? null) : null,
    capstoneTrack: row.hasCapstone
      ? (picked.find((t) => t.slug === CAPSTONE_SLUG) ?? null)
      : null,
  };
}

function describe(sel: TrackSelection, fallback: string): string {
  const names: string[] = [];
  if (sel.beginnerTrack) names.push(sel.beginnerTrack.name);
  if (sel.advancedTrack) names.push(sel.advancedTrack.name);
  if (sel.capstoneTrack) names.push(sel.capstoneTrack.name);
  return names.join(' + ') || fallback;
}

/**
 * The days a 2026 registration may be marked present for.
 *
 * Derived from the SKU plus its tracks' dates — never from the position of a
 * key in the stored map, and never from the stored keys alone. A capstone-only
 * buyer gets one checkbox and a bundle buyer gets five.
 *
 * The stored `attendance` map supplies the ticked values, and only those. If a
 * track's dates were edited after the sale, the entitlement moves with the track
 * and any stale key simply stops being rendered (it is preserved in the row, not
 * deleted — see the merge in /api/verify).
 */
export function daysForRegistration(row: Registration, sel: TrackSelection): TicketDay[] {
  let dates = entitledDates(sel);
  // Only if the tracks resolved to nothing at all — a deleted track row, or a
  // legacy import — do we fall back to whatever the row already carries, so the
  // door is never left with zero checkboxes for a real ticket.
  if (dates.length === 0) dates = Object.keys(row.attendance ?? {}).sort();

  return dates.map((date) => ({
    key: date,
    label: formatDayLabel(date),
    present: Boolean(row.attendance?.[date]),
  }));
}

async function lookup2026(orderId: string): Promise<TicketLookup | null> {
  const [row] = await db
    .select()
    .from(registrations)
    .where(eq(registrations.orderId, orderId))
    .limit(1);
  if (!row) return null;

  const sel = await selectionForRow(row);

  return {
    row,
    view: {
      edition: 2026,
      readOnly: false,
      name: row.name,
      orderId: row.orderId,
      course: row.course,
      year: row.year,
      department: row.department,
      description: describe(sel, row.sku),
      sku: row.sku,
      paymentStatus: row.paymentStatus,
      qrCodeUrl: row.qrCodeUrl,
      days: daysForRegistration(row, sel),
    },
  };
}

/**
 * The 2025 archive. Read-only, always.
 *
 * 2025 stored attendance as a positional `boolean[3]` and never recorded which
 * calendar day each slot meant, so the labels stay "Day 1..3". They are rendered
 * for the record and cannot be edited — the archive is never written to.
 */
async function lookup2025(orderId: string): Promise<TicketLookup | null> {
  const [row] = await db
    .select()
    .from(registrations2025)
    .where(eq(registrations2025.orderId, orderId))
    .limit(1);
  if (!row) return null;

  const marks = Array.isArray(row.attendance) ? row.attendance : [];
  const days = marks.map((present, i) => ({
    key: `day-${i + 1}`,
    label: `Day ${i + 1}`,
    present: Boolean(present),
  }));

  return {
    row: null,
    view: {
      edition: 2025,
      readOnly: true,
      name: row.name,
      orderId: row.orderId,
      course: row.course,
      year: row.year,
      department: row.department,
      description: row.domain || '2025 registration',
      sku: null,
      paymentStatus: row.paymentStatus,
      qrCodeUrl: row.qrCodeUrl,
      days,
    },
  };
}

/**
 * Find a ticket by orderId: the live table first, then the 2025 archive.
 *
 * Order matters only in theory — the two tables cannot share an orderId, since
 * migration 0007 moved every 2025 row out of the live table before it was
 * cleared — but checking the live table first keeps the common path to one query.
 */
export async function lookupTicket(orderId: string): Promise<TicketLookup | null> {
  return (await lookup2026(orderId)) ?? (await lookup2025(orderId));
}
