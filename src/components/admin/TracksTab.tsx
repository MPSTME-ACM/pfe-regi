'use client';

import { useCallback, useEffect, useState } from 'react';
import { clearStoredCreds } from '@/components/admin/AdminGate';

// ─────────────────────────────────────────────────────────────────────────────
// The Tracks tab.
//
// The seven tracks are seeded by migration 0008 and their `slug` is a machine
// key the checkout resolves against, so this editor is read + update only:
// no add, no delete, and `slug`/`segment` are shown but not editable. Everything
// the committee actually changes during the run-up — display name, capacity,
// dates, whether a track is offered at all, and the order it appears in — is.
// ─────────────────────────────────────────────────────────────────────────────

export interface AdminTrack {
  id: number;
  slug: string;
  name: string;
  segment: 'beginner' | 'advanced' | 'capstone';
  dates: string[];
  capacity: number;
  enabled: boolean;
  sortOrder: number;
  sold: number;
  held: number;
  full: boolean;
}

type Status = { kind: 'idle' | 'loading' | 'saving' | 'ok' | 'error'; message?: string };

/** Only these five fields go back to the server. `sold`/`held`/`full` are derived. */
type TrackPatch = Pick<AdminTrack, 'id' | 'name' | 'capacity' | 'dates' | 'enabled' | 'sortOrder'>;

const toPatch = (t: AdminTrack): TrackPatch => ({
  id: t.id,
  name: t.name,
  capacity: t.capacity,
  dates: t.dates,
  enabled: t.enabled,
  sortOrder: t.sortOrder,
});

export interface TracksEditor {
  tracks: AdminTrack[] | null;
  status: Status;
  dirty: boolean;
  holdMinutes: number;
  patch: (id: number, p: Partial<AdminTrack>) => void;
  save: () => Promise<void>;
  discard: () => void;
}

/**
 * Track list state. Loads the first time the tab is opened rather than on mount,
 * so a DB hiccup here cannot put an error banner in front of an admin who only
 * came to flip registration open.
 */
export function useTracksEditor(creds: string, active: boolean): TracksEditor {
  const [server, setServer] = useState<AdminTrack[] | null>(null);
  const [draft, setDraft] = useState<AdminTrack[] | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [holdMinutes, setHoldMinutes] = useState(30);
  const [requested, setRequested] = useState(false);

  const load = useCallback(async () => {
    setStatus({ kind: 'loading' });
    try {
      const res = await fetch('/api/admin/tracks', { headers: { Authorization: creds } });
      if (res.status === 401) {
        clearStoredCreds();
        window.location.reload();
        return;
      }
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || 'Failed to load tracks');
      setServer(data.tracks);
      setDraft(data.tracks);
      if (typeof data.pendingHoldMinutes === 'number') setHoldMinutes(data.pendingHoldMinutes);
      setStatus({ kind: 'idle' });
    } catch (e) {
      setStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, [creds]);

  useEffect(() => {
    if (!active || requested) return;
    setRequested(true);
    load();
  }, [active, requested, load]);

  const dirty = !!server && !!draft && JSON.stringify(server) !== JSON.stringify(draft);

  const patch = useCallback((id: number, p: Partial<AdminTrack>) => {
    setDraft((rows) => rows?.map((t) => (t.id === id ? { ...t, ...p } : t)) ?? rows);
  }, []);

  const save = useCallback(async () => {
    if (!draft) return;
    setStatus({ kind: 'saving' });
    try {
      const res = await fetch('/api/admin/tracks', {
        method: 'PATCH',
        headers: { Authorization: creds, 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracks: draft.map(toPatch) }),
      });
      if (res.status === 401) {
        clearStoredCreds();
        window.location.reload();
        return;
      }
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || 'Save failed');
      // The server re-reads and returns the row it actually wrote, including
      // fresh sold/held counts. Trust that, not the draft.
      setServer(data.tracks);
      setDraft(data.tracks);
      setStatus({ kind: 'ok', message: 'Saved' });
    } catch (e) {
      setStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, [creds, draft]);

  const discard = useCallback(() => {
    setDraft(server);
    setStatus({ kind: 'idle' });
  }, [server]);

  return { tracks: draft, status, dirty, holdMinutes, patch, save, discard };
}

// ─── presentation ────────────────────────────────────────────────────────────

// Kept character-for-character in step with the copy in app/admin/page.tsx.
// The two files cannot share a module without adding a third, so they are
// duplicated deliberately — change both or neither.
const input =
  'w-full bg-white/5 border border-white/20 rounded-lg px-4 py-3 text-white placeholder-gray-500 ' +
  'outline-none transition-[border-color,background-color,box-shadow] duration-200 ' +
  'hover:border-white/30 focus:border-transparent focus:ring-2 focus:ring-accent-soft';
const smallLabel = 'block text-[11px] font-medium uppercase tracking-wider text-gray-500 mb-1.5';

const SEGMENTS: { id: AdminTrack['segment']; title: string; blurb: string }[] = [
  { id: 'beginner', title: 'Beginner', blurb: 'Two days. Included in a bundle, or buyable on its own.' },
  { id: 'advanced', title: 'Advanced', blurb: 'Two days. Included in a bundle, or buyable on its own.' },
  { id: 'capstone', title: 'Capstone', blurb: 'One day. Sold alone or as the third part of a bundle.' },
];

const splitDates = (s: string) => s.split(/[\s,]+/).map((d) => d.trim()).filter(Boolean);

/**
 * Dates as one comma-separated line, buffered.
 *
 * The naive version — `value={dates.join(', ')}` straight off the draft — is
 * unusable: the separator you just typed is not yet part of a date, so it gets
 * filtered out and reappears from the join a keystroke later, and you can never
 * type a second date. So the text is local, and only re-synced from the draft
 * when the draft genuinely changed underneath us (a save, or a discard).
 */
function DatesInput({
  dates,
  onChange,
  slug,
}: {
  dates: string[];
  onChange: (dates: string[]) => void;
  slug: string;
}) {
  const [text, setText] = useState(() => dates.join(', '));

  // Only overwrite what the admin is typing when the saved dates actually
  // differ. Compared as a joined string with a separator that cannot occur in a
  // date, so ['2026-09-1','7'] never compares equal to ['2026-09-17'].
  //
  // The separator was originally a raw NUL byte, which made git classify this
  // .tsx as binary and stop diffing it entirely. A pipe is equally impossible in
  // an ISO date (splitDates only ever yields [-0-9] runs) and keeps the file text.
  useEffect(() => {
    const SEP = '|';
    setText((current) =>
      splitDates(current).join(SEP) === dates.join(SEP) ? current : dates.join(', '),
    );
  }, [dates]);

  return (
    <input
      className={`${input} font-mono text-sm`}
      value={text}
      placeholder="2026-09-17, 2026-09-18"
      aria-label={`Dates for ${slug}`}
      onChange={(e) => {
        setText(e.target.value);
        onChange(splitDates(e.target.value));
      }}
    />
  );
}

/**
 * A whole-number field that tolerates being empty mid-edit.
 *
 * Pushing `Number('')` upward would turn "select all, type 250" into a capacity
 * of 0 the instant the field is cleared. An empty or unparseable buffer simply
 * stops propagating; the last valid number stays in the draft.
 */
function NumberInput({
  value,
  onChange,
  ariaLabel,
}: {
  value: number;
  onChange: (n: number) => void;
  ariaLabel: string;
}) {
  const [text, setText] = useState(() => String(value));

  useEffect(() => {
    setText((current) => (current.trim() !== '' && Number(current) === value ? current : String(value)));
  }, [value]);

  return (
    <input
      type="number"
      min={0}
      step={1}
      className={input}
      value={text}
      aria-label={ariaLabel}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value.trim() !== '' && Number.isFinite(n) && n >= 0) onChange(Math.round(n));
      }}
    />
  );
}

/**
 * How full a track is, in one bar: settled seats solid, in-flight carts faded.
 *
 * The fill carries the state, because the number alone does not survive a
 * glance down a list of seven. Four steps: selling (accent), nearly out (amber),
 * exactly full (red), oversold (red, hatched). The hatch matters — `soldPct` is
 * clamped at 100, so without it a track at 120/120 and one at 140/120 draw an
 * identical solid bar and only the count tells them apart.
 */
function SeatBar({ track, muted }: { track: AdminTrack; muted?: boolean }) {
  const capacity = Math.max(track.capacity, 1);
  const soldPct = Math.min(100, (track.sold / capacity) * 100);
  const heldPct = Math.min(100 - soldPct, (track.held / capacity) * 100);
  const over = track.sold > track.capacity;
  const atCapacity = !over && track.sold >= track.capacity;
  const nearlyOut = !over && !atCapacity && soldPct + heldPct >= 80;

  const fill = muted
    ? 'bg-white/25'
    : over || atCapacity
      ? 'bg-red-400'
      : nearlyOut
        ? 'bg-amber-400'
        : 'bg-accent';
  const held = muted
    ? 'bg-white/10'
    : over || atCapacity
      ? 'bg-red-400/30'
      : nearlyOut
        ? 'bg-amber-400/30'
        : 'bg-accent/30';
  const count = muted
    ? 'text-gray-400'
    : over || atCapacity
      ? 'text-red-300'
      : 'text-white';

  return (
    <div>
      <div className="flex items-baseline gap-x-2.5 gap-y-1 flex-wrap">
        <span className={`text-xl font-semibold tabular-nums leading-none ${count}`}>
          {track.sold}
        </span>
        <span className="text-sm text-gray-500 tabular-nums">sold / {track.capacity}</span>
        {track.held > 0 && (
          <span className="text-xs text-gray-500 tabular-nums">+{track.held} holding</span>
        )}
        {track.full && (
          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-red-500/25 text-red-200 ring-1 ring-inset ring-red-400/50">
            Full
          </span>
        )}
      </div>
      <div className="mt-2.5 h-2.5 w-full rounded-full bg-white/[0.08] ring-1 ring-inset ring-white/10 overflow-hidden flex">
        {over ? (
          <div
            className={`h-full w-full ${fill}`}
            style={{
              backgroundImage:
                'repeating-linear-gradient(135deg, rgba(0,0,0,0.35) 0 4px, transparent 4px 9px)',
            }}
          />
        ) : (
          <>
            <div className={`h-full ${fill}`} style={{ width: `${soldPct}%` }} />
            <div className={`h-full ${held}`} style={{ width: `${heldPct}%` }} />
          </>
        )}
      </div>
    </div>
  );
}

/**
 * One track, as a row rather than a card.
 *
 * These used to be `bg-black/30` cards; the tab now sits inside a card of that
 * exact surface, and a card inside a card reads as a rendering mistake. Rows on
 * a shared hairline also line the seat bars up in one column, which is the whole
 * point of having a bar: you compare them.
 */
function TrackRow({
  track,
  onPatch,
}: {
  track: AdminTrack;
  onPatch: (p: Partial<AdminTrack>) => void;
}) {
  const off = !track.enabled;

  return (
    <div className="py-5 first:pt-0 last:pb-0">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <input
            className={`${input} text-base font-semibold`}
            value={track.name}
            onChange={(e) => onPatch({ name: e.target.value })}
            aria-label={`Name for ${track.slug}`}
          />
          <p className="text-[11px] text-gray-500 mt-1.5 font-mono">{track.slug}</p>
        </div>
        {/* A disabled track keeps fully legible controls — it is dimmed by its
            seat bar and this pill, not by fading the whole row out. */}
        <button
          type="button"
          onClick={() => onPatch({ enabled: !track.enabled })}
          className={`shrink-0 min-h-[44px] px-3.5 text-xs font-bold rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-soft ${
            track.enabled
              ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-400/40 hover:bg-emerald-500/25'
              : 'bg-white/[0.04] text-gray-500 ring-1 ring-inset ring-white/15 hover:bg-white/10 hover:text-gray-300'
          }`}
        >
          {track.enabled ? 'Enabled' : 'Disabled'}
        </button>
      </div>

      <div className="mt-4">
        <SeatBar track={track} muted={off} />
      </div>

      <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-4">
        <div className="col-span-2">
          <span className={smallLabel}>Dates</span>
          <DatesInput
            dates={track.dates}
            slug={track.slug}
            onChange={(dates) => onPatch({ dates })}
          />
        </div>
        <div>
          <span className={smallLabel}>Capacity</span>
          <NumberInput
            value={track.capacity}
            ariaLabel={`Capacity for ${track.slug}`}
            onChange={(capacity) => onPatch({ capacity })}
          />
        </div>
        <div>
          <span className={smallLabel}>Order</span>
          <NumberInput
            value={track.sortOrder}
            ariaLabel={`Sort order for ${track.slug}`}
            onChange={(sortOrder) => onPatch({ sortOrder })}
          />
        </div>
      </div>
    </div>
  );
}

export function TracksTab({ editor }: { editor: TracksEditor }) {
  const { tracks, status, holdMinutes, patch } = editor;

  if (!tracks) {
    return (
      <section className="text-sm">
        {status.kind === 'error' ? (
          <p className="text-red-300">{status.message}</p>
        ) : (
          <p className="text-gray-400">Loading tracks…</p>
        )}
      </section>
    );
  }

  const capstoneOff = tracks.some((t) => t.segment === 'capstone' && !t.enabled);

  return (
    <section>
      <p className="text-sm leading-relaxed text-gray-400 max-w-[68ch]">
        Sold counts settled registrations — paid and comped. A checkout in progress holds its seat
        for {holdMinutes} minutes and shows as <em>holding</em>; those seats count towards FULL on
        the public form, which is why a track can read as full below its sold number.
      </p>
      <p className="mt-3 text-xs leading-relaxed text-gray-500 max-w-[78ch]">
        Slug and segment are fixed — the checkout resolves tracks by slug. Editing dates changes what
        new tickets are issued for; tickets already sold keep the dates they were bought with. Order
        is one list across all segments, not per segment: the registration form sorts by it flat, so
        keep beginner numbers below advanced ones.
      </p>

      {capstoneOff && (
        <div className="mt-6 rounded-xl border border-amber-400/35 bg-amber-400/[0.08] p-4">
          <p className="text-sm font-semibold text-amber-300">Capstone is disabled</p>
          <p className="mt-1 text-sm leading-relaxed text-gray-300 max-w-[64ch]">
            With the capstone day off, both the Capstone and Bundle products stop being purchasable —
            a bundle includes capstone by definition. Only single tracks remain on sale.
          </p>
        </div>
      )}

      {/* Segments are told apart by type and by the air around them, not by a
          box each: a container per segment would put a card inside the tab card
          inside the page, which is one card too many in either direction. */}
      {SEGMENTS.map((segment) => {
        const rows = tracks.filter((t) => t.segment === segment.id);
        if (rows.length === 0) return null;
        return (
          <div key={segment.id} className="mt-8 pt-8 border-t border-white/10">
            <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-accent-soft">
              {segment.title}
            </h2>
            <p className="mt-1.5 text-xs leading-relaxed text-gray-500 max-w-[62ch]">
              {segment.blurb}
            </p>
            <div className="mt-5 divide-y divide-white/[0.07]">
              {rows.map((t) => (
                <TrackRow key={t.id} track={t} onPatch={(p) => patch(t.id, p)} />
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}
