import { describe, it, expect } from 'vitest';
import {
  parseRoster,
  serializeRoster,
  findTicket,
  upsertTicket,
  applyAttendance,
  overlayPending,
  type CachedRoster,
} from './roster';

/**
 * The roster cache is what a scan resolves against when the network is gone.
 * A wrong merge here shows the wrong name or the wrong verdict at the door,
 * so the fallback rules are pinned: server data always wins, local marks only
 * ever flip the days they patched.
 */
const ticket = {
  edition: 2026 as const,
  readOnly: false as const,
  name: 'Aarav Shah',
  orderId: 'ORD1',
  course: 'BTech',
  year: 'Second Year',
  department: 'Computer Engineering',
  description: 'AI Foundations',
  sku: 'single',
  hasCapstone: false,
  paymentStatus: 'success',
  days: [
    { key: '2026-09-17', label: 'Thu 17 Sep', present: false },
    { key: '2026-09-18', label: 'Fri 18 Sep', present: false },
  ],
};

const roster: CachedRoster = { fetchedAt: '2026-09-17T08:00:00.000Z', tickets: [ticket] };

describe('parseRoster', () => {
  it('round-trips through serialize', () => {
    expect(parseRoster(serializeRoster(roster))).toEqual(roster);
  });

  it('returns null for null, garbage and ticket-less payloads', () => {
    expect(parseRoster(null)).toEqual(null);
    expect(parseRoster('garbage')).toEqual(null);
    expect(parseRoster(JSON.stringify({ fetchedAt: 'x', tickets: [] }))).toEqual(null);
  });

  it('keeps valid tickets and drops corrupt ones', () => {
    const raw = JSON.stringify({ fetchedAt: 'x', tickets: [ticket, { orderId: 7 }] });
    expect(parseRoster(raw)?.tickets).toHaveLength(1);
  });
});

describe('findTicket', () => {
  it('finds by orderId and misses cleanly', () => {
    expect(findTicket(roster, 'ORD1')?.name).toBe('Aarav Shah');
    expect(findTicket(roster, 'NOPE')).toBeNull();
    expect(findTicket(null, 'ORD1')).toBeNull();
  });
});

describe('upsertTicket', () => {
  it('replaces a stale cached entry with the server version', () => {
    const next = upsertTicket(roster, {
      ...ticket,
      paymentStatus: 'comped',
      days: ticket.days.map((d) => ({ ...d, present: true })),
    });
    expect(next.tickets).toHaveLength(1);
    expect(next.tickets[0].paymentStatus).toBe('comped');
    expect(next.tickets[0].days.every((d) => d.present)).toBe(true);
  });

  it('adds a ticket the roster never had', () => {
    const next = upsertTicket(roster, { ...ticket, orderId: 'ORD2', name: 'Diya' });
    expect(next.tickets.map((t) => t.orderId)).toEqual(['ORD1', 'ORD2']);
  });

  it('refuses a 2025 archived ticket — it must never become a writable cache entry', () => {
    const next = upsertTicket(roster, { ...ticket, edition: 2025 });
    expect(next).toBe(roster);
  });
});

describe('overlayPending', () => {
  it('pending marks win over cached values, unpatched days untouched', () => {
    const days = applyAttendance(roster, 'ORD1', { '2026-09-18': true }).tickets[0].days;
    const shown = overlayPending(days, { '2026-09-18': false, '2026-09-17': true });
    expect(shown[0].present).toBe(true);
    expect(shown[1].present).toBe(false);
  });

  it('passes days through with no pending patch', () => {
    expect(overlayPending(roster.tickets[0].days, undefined)).toBe(roster.tickets[0].days);
  });
});

describe('applyAttendance', () => {
  it('flips only the patched days', () => {
    const next = applyAttendance(roster, 'ORD1', { '2026-09-17': true });
    expect(next.tickets[0].days[0].present).toBe(true);
    expect(next.tickets[0].days[1].present).toBe(false);
  });

  it('leaves other tickets untouched', () => {
    const two: CachedRoster = { ...roster, tickets: [ticket, { ...ticket, orderId: 'ORD2' }] };
    const next = applyAttendance(two, 'ORD1', { '2026-09-17': true });
    expect(next.tickets[1].days[0].present).toBe(false);
  });
});
