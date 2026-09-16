// ─────────────────────────────────────────────────────────────────────────────
// The door scanner's offline roster cache.
//
// While online the scanner downloads GET /api/verify/roster (every live 2026
// registration, compact) and holds it here, persisted to localStorage. A scan
// with no network resolves against this instead of failing — the volunteer
// sees the name, the verdict and the day checkboxes, and marks attendance into
// the outbox for later flush.
//
// Entries mirror the TicketView the page already renders, minus qrCodeUrl (a
// data URL would bloat a ~1000-row payload for a field the door never reads).
// Pure: storage lives in the page, tests drive these directly.
// ─────────────────────────────────────────────────────────────────────────────

export interface RosterDay {
  key: string;
  label: string;
  present: boolean;
}

export interface RosterTicket {
  edition: 2026;
  readOnly: false;
  name: string;
  orderId: string;
  course: string | null;
  year: string | null;
  department: string | null;
  description: string;
  sku: string;
  hasCapstone: boolean;
  paymentStatus: string;
  days: RosterDay[];
}

export interface CachedRoster {
  /** ISO timestamp from the server response. Drives the "roster age" UI. */
  fetchedAt: string;
  tickets: RosterTicket[];
}

function isTicket(t: unknown): t is RosterTicket {
  if (typeof t !== 'object' || t === null) return false;
  const o = t as Record<string, unknown>;
  return (
    typeof o['orderId'] === 'string' &&
    typeof o['name'] === 'string' &&
    typeof o['paymentStatus'] === 'string' &&
    Array.isArray(o['days'])
  );
}

/** Parse persisted state. Garbage in → null (no roster), never a throw. */
export function parseRoster(raw: string | null | undefined): CachedRoster | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const o = parsed as { fetchedAt?: unknown; tickets?: unknown };
    if (typeof o.fetchedAt !== 'string' || !Array.isArray(o.tickets)) return null;
    const tickets = o.tickets.filter(isTicket);
    if (tickets.length === 0) return null;
    return { fetchedAt: o.fetchedAt, tickets };
  } catch {
    return null;
  }
}

export function serializeRoster(roster: CachedRoster): string {
  return JSON.stringify(roster);
}

export function findTicket(roster: CachedRoster | null, orderId: string): RosterTicket | null {
  if (!roster) return null;
  return roster.tickets.find((t) => t.orderId === orderId) ?? null;
}

/**
 * Refresh one entry from a live server lookup (the POST /api/verify read
 * returns a full TicketView). Server data always wins — the roster is a
 * fallback, not a source of truth.
 *
 * 2025 archived tickets are refused: they are read-only, and caching one as a
 * writable 2026 entry would let a volunteer "mark" attendance offline that the
 * flush then silently discards.
 */
export function upsertTicket(
  roster: CachedRoster,
  ticket: {
    edition?: 2025 | 2026;
    orderId: string;
    name: string;
    course: string | null;
    year: string | null;
    department: string | null;
    description: string;
    sku: string | null;
    /** The page's TicketView does not carry this; absent means unknown. */
    hasCapstone?: boolean;
    paymentStatus: string | null;
    days: RosterDay[];
  },
): CachedRoster {
  if (ticket.edition === 2025) return roster;
  const next: RosterTicket = {
    edition: 2026,
    readOnly: false,
    name: ticket.name,
    orderId: ticket.orderId,
    course: ticket.course,
    year: ticket.year,
    department: ticket.department,
    description: ticket.description,
    sku: ticket.sku ?? '',
    hasCapstone: ticket.hasCapstone ?? false,
    paymentStatus: ticket.paymentStatus ?? '',
    days: ticket.days.map((d) => ({ key: d.key, label: d.label, present: d.present })),
  };
  const idx = roster.tickets.findIndex((t) => t.orderId === ticket.orderId);
  if (idx === -1) return { ...roster, tickets: [...roster.tickets, next] };
  return { ...roster, tickets: roster.tickets.map((t, i) => (i === idx ? next : t)) };
}

/**
 * Overlay the still-queued outbox patch onto a ticket's days for rendering.
 *
 * When a mark is queued but not yet acked, the server's answer does not carry
 * it yet — rendering bare server state would show "absent" for a day the
 * volunteer just marked, in front of the attendee. The pending patch is the
 * volunteer's latest intent, so it wins until the flush acks it.
 */
export function overlayPending(
  days: RosterDay[],
  patch: Record<string, boolean> | undefined,
): RosterDay[] {
  if (!patch) return days;
  return days.map((d) => (d.key in patch ? { ...d, present: patch[d.key] } : d));
}

/** Optimistic local mark: flip the cached days to match a just-saved patch. */
export function applyAttendance(
  roster: CachedRoster,
  orderId: string,
  patch: Record<string, boolean>,
): CachedRoster {
  return {
    ...roster,
    tickets: roster.tickets.map((t) =>
      t.orderId !== orderId
        ? t
        : {
            ...t,
            days: t.days.map((d) =>
              d.key in patch ? { ...d, present: patch[d.key] } : d,
            ),
          },
    ),
  };
}
