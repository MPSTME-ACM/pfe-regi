'use client';

import { useCallback, useMemo, useState } from 'react';
import { clearStoredCreds } from '@/components/admin/AdminGate';

// ─────────────────────────────────────────────────────────────────────────────
// The Edit-registration tab: move someone onto different tracks after paying.
//
// Swaps are PRICE-NEUTRAL by construction — the API re-derives everything from
// the row, and this UI's confirmation card is presentation, not authority. What
// the server will not do, this screen cannot suggest: there is no control for
// sku, capstone or the amount, and a picker only ever offers tracks in the same
// segment as the slot it fills.
//
// Like CouponsTab (and unlike the settings/tracks editors), there is no
// draft, no `dirty`, no save/discard — every write here applies on its own
// request behind its own confirmation step. Folding this into the tab-scoped
// sticky save bar would repeat the exact wrong-editor failure CLAUDE.md lists
// as a landmine: a Save pressed here must never transmit the SETTINGS draft.
// ─────────────────────────────────────────────────────────────────────────────

/** A row from GET /api/admin/registrations. Money arrives as integer paise. */
export interface RegistrationView {
  orderId: string;
  name: string;
  email: string;
  sku: string | null;
  beginnerTrackId: number | null;
  advancedTrackId: number | null;
  hasCapstone: boolean;
  amountPaid: number;
  paymentStatus: string | null;
  emailSentAt: string | null;
  createdAt: string | null;
  description: string;
  attendance: Record<string, boolean>;
  editable: boolean;
}

/** One entry of `tracks` from the same GET — sold counts, pending holds included. */
export interface TrackOption {
  id: number;
  slug: string;
  name: string;
  segment: 'beginner' | 'advanced' | 'capstone';
  dates: string[];
  capacity: number;
  used: number;
  remaining: number;
  full: boolean;
}

export type LookupResult =
  | { ok: true; matches: RegistrationView[] }
  | { ok: false; message: string };

export type SaveResult =
  | { ok: true; registration: RegistrationView; addedDates: string[] }
  | { ok: false; message: string };

export type ResendResult =
  | { ok: true; emailSentAt: string }
  | { ok: false; message: string };

type Status = { kind: 'idle' | 'loading' | 'saving' | 'sending' | 'ok' | 'error'; message?: string };

export interface EditRegistrationEditor {
  matches: RegistrationView[] | null;
  tracks: TrackOption[] | null;
  status: Status;
  lookup: (query: string) => Promise<void>;
  reset: () => void;
  save: (
    orderId: string,
    req: { beginnerTrackId?: number; advancedTrackId?: number },
  ) => Promise<SaveResult>;
  resend: (orderId: string) => Promise<ResendResult>;
  // No `dirty`, no `save` binding for the sticky bar. See the header.
}

/**
 * Order ID or email? Anything containing "@" is an email; everything else is an
 * order ID. Order IDs are OPAQUE — no sniffing of prefixes here, and none
 * needed: the server matches exactly whichever column we name.
 */
export function isEmailQuery(query: string): boolean {
  return query.includes('@');
}

/** Server-side caps mirrored so the UI refuses what the route would 400. */
const MAX_MATCHES = 20;

export function useEditRegistration(creds: string): EditRegistrationEditor {
  const [matches, setMatches] = useState<RegistrationView[] | null>(null);
  const [tracks, setTracks] = useState<TrackOption[] | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  /** A 401 means the shared password changed under us. Bounce to the login. */
  const expired = useCallback((res: Response) => {
    if (res.status !== 401) return false;
    clearStoredCreds();
    window.location.reload();
    return true;
  }, []);

  const lookup = useCallback(
    async (query: string) => {
      const q = query.trim();
      if (!q) return;
      setStatus({ kind: 'loading' });
      try {
        const param = isEmailQuery(q) ? `email=${encodeURIComponent(q)}` : `orderId=${encodeURIComponent(q)}`;
        const res = await fetch(`/api/admin/registrations?${param}`, {
          headers: { Authorization: creds },
        });
        if (expired(res)) return;
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.message || 'Lookup failed');
        setMatches(data.matches);
        setTracks(data.tracks);
        setStatus({ kind: 'idle' });
      } catch (e) {
        setStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    },
    [creds, expired],
  );

  const reset = useCallback(() => {
    setMatches(null);
    setTracks(null);
    setStatus({ kind: 'idle' });
  }, []);

  const save = useCallback(
    async (
      orderId: string,
      req: { beginnerTrackId?: number; advancedTrackId?: number },
    ): Promise<SaveResult> => {
      setStatus({ kind: 'saving' });
      try {
        const res = await fetch('/api/admin/registrations', {
          method: 'PATCH',
          headers: { Authorization: creds, 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId, ...req }),
        });
        if (expired(res)) return { ok: false, message: 'Session expired' };
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.message || 'Swap failed');
        setMatches([data.registration]);
        setTracks(data.tracks);
        setStatus({ kind: 'ok', message: 'Tracks updated' });
        return { ok: true, registration: data.registration, addedDates: data.addedDates ?? [] };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setStatus({ kind: 'error', message });
        return { ok: false, message };
      }
    },
    [creds, expired],
  );

  const resend = useCallback(
    async (orderId: string): Promise<ResendResult> => {
      setStatus({ kind: 'sending' });
      try {
        const res = await fetch('/api/admin/registrations', {
          method: 'POST',
          headers: { Authorization: creds, 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId, action: 'resend-ticket' }),
        });
        if (expired(res)) return { ok: false, message: 'Session expired' };
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.message || 'Resend failed');
        setStatus({ kind: 'ok', message: 'Ticket email sent' });
        return { ok: true, emailSentAt: data.emailSentAt };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setStatus({ kind: 'error', message });
        return { ok: false, message };
      }
    },
    [creds, expired],
  );

  return { matches, tracks, status, lookup, reset, save, resend };
}

// ─── formatting ──────────────────────────────────────────────────────────────

// Local, two lines, on purpose — @/lib/settings imports the database, and this
// is a client component. Same paise → rupees rule as CouponsTab.
const rupees = (paise: number) =>
  `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** "2026-09-17" → "Thu 17 Sep", without toLocaleDateString (locale drift). */
function dayLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
  const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  return `${wd} ${Number(m[3])} ${mo}`;
}

const SKU_LABELS: Record<string, string> = {
  capstone: 'Capstone Day',
  single: 'Single Track',
  bundle: 'Full Bundle',
};

function StatusBadge({ status }: { status: string | null }) {
  const map: Record<string, string> = {
    success: 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/40',
    comped: 'bg-accent/15 text-accent-soft ring-accent/40',
    pending: 'bg-amber-400/15 text-amber-300 ring-amber-400/40',
    failure: 'bg-red-500/15 text-red-300 ring-red-400/40',
  };
  const cls = (status && map[status]) || 'bg-white/[0.06] text-gray-300 ring-hairline';
  return (
    <span className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1 ring-inset ${cls}`}>
      {status ?? 'unknown'}
    </span>
  );
}

// ─── shared classes ──────────────────────────────────────────────────────────

const input =
  'w-full bg-white/5 border border-hairline rounded-lg px-3.5 py-3 text-white placeholder-gray-500 ' +
  'outline-none transition-[border-color,background-color,box-shadow] duration-200 ' +
  'hover:border-hairline/80 focus:border-accent/60 focus:ring-2 focus:ring-accent/25';
const smallLabel = 'block text-[11px] font-medium uppercase tracking-wider text-gray-400 mb-1.5';
const ghostButton =
  'inline-flex min-h-[44px] items-center justify-center rounded-lg border border-hairline bg-white/[0.04] ' +
  'px-3.5 text-sm text-gray-300 transition-colors hover:bg-white/10 hover:text-white ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-soft';
const primaryButton =
  'inline-flex min-h-[44px] items-center justify-center rounded-lg bg-accent px-5 font-bold text-black ' +
  'transition-[box-shadow,transform,opacity] duration-200 ease-out hover:shadow-lg hover:shadow-accent/40 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:scale-[0.99] ' +
  'disabled:opacity-40 disabled:hover:shadow-none disabled:active:scale-100';
const dangerButton =
  'inline-flex min-h-[44px] items-center justify-center rounded-lg border border-accent/40 bg-accent/15 px-5 ' +
  'font-bold text-accent-soft transition-colors hover:bg-accent/25 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-soft ' +
  'disabled:opacity-40';

// ─── the tab ─────────────────────────────────────────────────────────────────

type Phase = 'search' | 'pick' | 'edit' | 'confirm';

export function EditRegistrationTab({ editor }: { editor: EditRegistrationEditor }) {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [beginnerId, setBeginnerId] = useState<number | null>(null);
  const [advancedId, setAdvancedId] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>('search');
  const [saved, setSaved] = useState<{ after: string; addedDates: string[] } | null>(null);
  const [resentAt, setResentAt] = useState<string | null>(null);

  const matches = editor.matches;
  const tracks = editor.tracks;
  const selected = useMemo(
    () => matches?.find((m) => m.orderId === selectedId) ?? null,
    [matches, selectedId],
  );

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaved(null);
    setResentAt(null);
    setSelectedId(null);
    setBeginnerId(null);
    setAdvancedId(null);
    await editor.lookup(query);
    setPhase('pick');
  };

  const openRow = (view: RegistrationView) => {
    setSelectedId(view.orderId);
    setBeginnerId(view.beginnerTrackId);
    setAdvancedId(view.advancedTrackId);
    setSaved(null);
    setResentAt(null);
    setPhase('edit');
  };

  const busy =
    editor.status.kind === 'loading' || editor.status.kind === 'saving' || editor.status.kind === 'sending';

  if (!matches) {
    return (
      <section>
        <p className="max-w-[68ch] text-sm leading-relaxed text-gray-400">
          Move someone onto different tracks — the swap students ask for after paying. It is
          price-neutral by construction: a replacement must fill the same kind of slot, and the
          amount they paid, their SKU and the capstone day are untouchable here. Capacity is
          checked live against holds in flight, exactly like checkout.
        </p>
        <form onSubmit={search} className="mt-6 flex flex-col gap-3 sm:flex-row">
          <div className="flex-1">
            <label htmlFor="er-query" className={smallLabel}>
              Order ID or email
            </label>
            <input
              id="er-query"
              className={`${input} font-mono`}
              value={query}
              placeholder="PFE-XXXXXXXXXX or student@example.com"
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="flex items-end">
            <button type="submit" disabled={busy || !query.trim()} className={primaryButton}>
              {editor.status.kind === 'loading' ? 'Looking…' : 'Find'}
            </button>
          </div>
        </form>
        {editor.status.kind === 'error' && (
          <p role="alert" className="mt-4 text-sm text-red-300">
            {editor.status.message}
          </p>
        )}
      </section>
    );
  }

  const list = matches.slice(0, MAX_MATCHES);

  return (
    <section>
      {/* Every state keeps the search reachable — staff frequently look up the
          next student mid-flow. */}
      <form
        onSubmit={(e) => {
          void search(e);
        }}
        className="flex flex-col gap-3 sm:flex-row"
      >
        <input
          aria-label="Order ID or email"
          className={`${input} font-mono flex-1`}
          value={query}
          placeholder="PFE-XXXXXXXXXX or student@example.com"
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit" disabled={busy || !query.trim()} className={ghostButton}>
          {editor.status.kind === 'loading' ? 'Looking…' : 'Find'}
        </button>
        <button type="button" onClick={() => { editor.reset(); setPhase('search'); }} className={ghostButton}>
          Clear
        </button>
      </form>

      {editor.status.kind === 'error' && (
        <p role="alert" className="mt-4 text-sm text-red-300">
          {editor.status.message}
        </p>
      )}

      {phase === 'pick' && (
        <div className="mt-6">
          {list.length === 0 ? (
            <p className="rounded-xl border border-dashed border-hairline px-6 py-10 text-center text-sm text-gray-500">
              No registration found for that {isEmailQuery(query) ? 'email' : 'order ID'}.
            </p>
          ) : list.length === 1 ? (
            // One hit — the common case. Open it straight away rather than ask.
            <OpenRow view={list[0]} onOpen={openRow} />
          ) : (
            <div className="divide-y divide-hairline/60 rounded-xl border border-hairline">
              <p className="px-4 py-3 text-xs text-gray-400">
                {list.length} registration{list.length === 1 ? '' : 's'} match — pick one. Newest first.
              </p>
              {list.map((v) => (
                <button
                  key={v.orderId}
                  type="button"
                  onClick={() => openRow(v)}
                  className="flex w-full min-h-[44px] flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left transition-colors hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent-soft"
                >
                  <span className="font-mono text-sm font-semibold text-white">{v.orderId}</span>
                  <span className="text-sm text-gray-300">{v.name}</span>
                  <span className="text-xs text-gray-500">{v.email}</span>
                  <span className="ml-auto flex items-center gap-2">
                    <StatusBadge status={v.paymentStatus} />
                    <span className="text-xs text-gray-400">{v.description}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {selected && phase !== 'pick' && tracks && (
        <EditCard
          view={selected}
          tracks={tracks}
          editor={editor}
          beginnerId={beginnerId}
          advancedId={advancedId}
          setBeginnerId={setBeginnerId}
          setAdvancedId={setAdvancedId}
          phase={phase}
          setPhase={setPhase}
          saved={saved}
          setSaved={setSaved}
          resentAt={resentAt}
          onResent={setResentAt}
        />
      )}
    </section>
  );
}

/** The one-hit card: what they bought, read-only, with an Edit button. */
function OpenRow({ view, onOpen }: { view: RegistrationView; onOpen: (v: RegistrationView) => void }) {
  return (
    <div className="rounded-xl border border-hairline bg-white/[0.02] p-4 sm:p-5">
      <Summary view={view} />
      <button type="button" onClick={() => onOpen(view)} className={`${ghostButton} mt-4`} disabled={!view.editable}>
        {view.editable ? 'Change tracks' : 'Read-only (2025 archive)'}
      </button>
    </div>
  );
}

function Summary({ view }: { view: RegistrationView }) {
  const days = Object.entries(view.attendance).sort(([a], [b]) => a.localeCompare(b));
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-lg font-semibold text-white">{view.name}</p>
        <StatusBadge status={view.paymentStatus} />
      </div>
      <p className="mt-0.5 font-mono text-xs text-gray-400">{view.orderId}</p>
      <p className="text-xs text-gray-500">{view.email}</p>

      <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <div>
          <dt className={smallLabel}>Bought</dt>
          <dd className="text-sm text-gray-200">{view.description}</dd>
        </div>
        <div>
          <dt className={smallLabel}>SKU</dt>
          <dd className="text-sm text-gray-200">{view.sku ? (SKU_LABELS[view.sku] ?? view.sku) : '—'}</dd>
        </div>
        <div>
          <dt className={smallLabel}>Paid</dt>
          <dd className="text-sm tabular-nums text-gray-200">{rupees(view.amountPaid)}</dd>
        </div>
        <div>
          <dt className={smallLabel}>Ticket email</dt>
          <dd className="text-sm text-gray-200">
            {view.emailSentAt ? new Date(view.emailSentAt).toLocaleString() : 'never sent'}
          </dd>
        </div>
      </dl>

      {days.length > 0 && (
        <div className="mt-4">
          <p className={smallLabel}>Attendance (date-keyed, existing marks are never removed)</p>
          <div className="flex flex-wrap gap-2">
            {days.map(([date, present]) => (
              <span
                key={date}
                className={`rounded-lg px-2.5 py-1 text-xs ring-1 ring-inset ${
                  present
                    ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/40'
                    : 'bg-white/[0.04] text-gray-400 ring-hairline'
                }`}
              >
                {dayLabel(date)} · {present ? 'present' : '—'}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── the editor card ─────────────────────────────────────────────────────────

interface EditCardProps {
  view: RegistrationView;
  tracks: TrackOption[];
  editor: EditRegistrationEditor;
  beginnerId: number | null;
  advancedId: number | null;
  setBeginnerId: (v: number | null) => void;
  setAdvancedId: (v: number | null) => void;
  phase: Phase;
  setPhase: (p: Phase) => void;
  saved: { after: string; addedDates: string[] } | null;
  setSaved: (s: { after: string; addedDates: string[] } | null) => void;
  resentAt: string | null;
  onResent: (iso: string) => void;
}

/** Dates the chosen selection adds over the current one, for the diff line. */
function addedKeys(view: RegistrationView, options: TrackOption[], beginner: number | null, advanced: number | null): string[] {
  const dates = new Set<string>();
  for (const opt of options) {
    if (opt.id === beginner || opt.id === advanced) for (const d of opt.dates) dates.add(d);
  }
  if (view.hasCapstone) {
    for (const cap of options) if (cap.slug === 'capstone') for (const d of cap.dates) dates.add(d);
  }
  return [...dates].filter((d) => !(d in view.attendance)).sort();
}

function describeSelection(
  options: TrackOption[],
  beginner: number | null,
  advanced: number | null,
  hasCapstone: boolean,
): string {
  const names: string[] = [];
  for (const id of [beginner, advanced]) {
    const t = options.find((o) => o.id === id);
    if (t) names.push(t.name);
  }
  if (hasCapstone) {
    const cap = options.find((o) => o.slug === 'capstone');
    names.push(cap?.name ?? 'Capstone Day');
  }
  return names.join(' + ') || '(no tracks)';
}

function TrackPicker({
  slot,
  value,
  current,
  options,
  onChange,
}: {
  slot: 'beginner' | 'advanced';
  value: number | null;
  current: number | null;
  options: TrackOption[];
  onChange: (id: number) => void;
}) {
  const eligible = options.filter((o) => o.segment === slot);
  return (
    <div>
      <label htmlFor={`er-${slot}`} className={smallLabel}>
        {slot === 'beginner' ? 'Beginner track' : 'Advanced track'}
      </label>
      <select
        id={`er-${slot}`}
        className={input}
        value={value ?? ''}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        {eligible.map((o) => (
          <option key={o.id} value={o.id} disabled={o.full && o.id !== current}>
            {o.name} — {o.remaining} of {o.capacity} left{o.full && o.id !== current ? ' (full)' : ''}
          </option>
        ))}
      </select>
      {eligible.find((o) => o.id === value)?.dates.length ? (
        <p className="mt-1.5 text-xs text-gray-500">
          Runs {eligible.find((o) => o.id === value)!.dates.map(dayLabel).join(', ')}
        </p>
      ) : null}
    </div>
  );
}

function EditCard(props: EditCardProps) {
  const { view, tracks, editor, phase, setPhase, saved, setSaved, resentAt, onResent } = props;
  const { beginnerId, advancedId, setBeginnerId, setAdvancedId } = props;
  const [resending, setResending] = useState(false);

  const busy =
    editor.status.kind === 'loading' || editor.status.kind === 'saving' || editor.status.kind === 'sending';

  const isBundle = view.sku === 'bundle';
  const isCapstoneOnly = view.sku === 'capstone';
  const occupiedSlot: 'beginner' | 'advanced' | null =
    view.beginnerTrackId !== null ? 'beginner' : view.advancedTrackId !== null ? 'advanced' : null;

  const before = describeSelection(tracks, view.beginnerTrackId, view.advancedTrackId, view.hasCapstone);
  const after = describeSelection(tracks, beginnerId, advancedId, view.hasCapstone);
  const changed = beginnerId !== view.beginnerTrackId || advancedId !== view.advancedTrackId;
  const adds = addedKeys(view, tracks, beginnerId, advancedId);

  const doSave = async () => {
    if (!view.editable || !changed) return;
    const req: { beginnerTrackId?: number; advancedTrackId?: number } = {};
    if (beginnerId !== view.beginnerTrackId && beginnerId !== null) req.beginnerTrackId = beginnerId;
    if (advancedId !== view.advancedTrackId && advancedId !== null) req.advancedTrackId = advancedId;
    const res = await editor.save(view.orderId, req);
    if (res.ok) {
      setSaved({ after: res.registration.description, addedDates: res.addedDates });
      setPhase('edit');
    } else {
      setSaved(null);
    }
  };

  const doResend = async () => {
    setResending(true);
    const res = await editor.resend(view.orderId);
    setResending(false);
    if (res.ok) onResent(res.emailSentAt);
  };

  if (isCapstoneOnly) {
    return (
      <div className="mt-6 rounded-xl border border-hairline bg-white/[0.02] p-4 sm:p-5">
        <Summary view={view} />
        <p className="mt-4 text-sm text-gray-400">
          A capstone-only registration has no track slots to swap. Changing what they bought needs
          a separate refund/top-up flow — this screen deliberately cannot do it.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-xl border border-hairline bg-white/[0.02] p-4 sm:p-5">
      <Summary view={view} />

      {!view.editable ? (
        <p className="mt-4 text-sm text-amber-300">
          Archived 2025 ticket — read-only. Attendance cannot be edited.
        </p>
      ) : (
        <>
          <div className="mt-5 grid gap-x-4 gap-y-4 sm:grid-cols-2">
            {(isBundle || occupiedSlot === 'beginner') && (
              <TrackPicker
                slot="beginner"
                value={beginnerId}
                current={view.beginnerTrackId}
                options={tracks}
                onChange={setBeginnerId}
              />
            )}
            {(isBundle || occupiedSlot === 'advanced') && (
              <TrackPicker
                slot="advanced"
                value={advancedId}
                current={view.advancedTrackId}
                options={tracks}
                onChange={setAdvancedId}
              />
            )}
            {!isBundle && occupiedSlot === null && (
              <p className="text-sm text-gray-400">This registration has no track slots.</p>
            )}
          </div>

          {changed && (
            <div className="mt-5 rounded-lg border border-hairline bg-panel px-3.5 py-3 text-sm text-gray-300">
              <p>
                <span className="text-gray-500">Before: </span>
                {before}
              </p>
              <p>
                <span className="text-gray-500">After: </span>
                {after}
              </p>
              <p className="mt-1 text-xs text-gray-400">
                {rupees(view.amountPaid)} stays {rupees(view.amountPaid)} — SKU, capstone and the
                amount are never touched.
              </p>
              <p className="mt-0.5 text-xs text-gray-400">
                {adds.length
                  ? `Adds attendance boxes for: ${adds.map(dayLabel).join(', ')}. Existing marks are kept.`
                  : 'Attendance days are unchanged.'}
              </p>
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-3">
            {phase !== 'confirm' ? (
              <button
                type="button"
                disabled={!changed || busy}
                onClick={() => setPhase('confirm')}
                className={primaryButton}
              >
                Review change
              </button>
            ) : (
              <>
                <button type="button" onClick={() => void doSave()} disabled={busy} className={dangerButton}>
                  {editor.status.kind === 'saving' ? 'Saving…' : 'Confirm swap'}
                </button>
                <button type="button" onClick={() => setPhase('edit')} className={ghostButton} disabled={busy}>
                  Cancel
                </button>
              </>
            )}
            {editor.status.kind === 'error' && <span className="text-sm text-red-300">{editor.status.message}</span>}
          </div>

          {phase === 'confirm' && (
            <p className="mt-3 max-w-[60ch] text-xs leading-relaxed text-amber-300/90">
              Confirming moves <span className="font-semibold">{view.name}</span> from {before} to{' '}
              {after} and merges attendance. The server re-checks capacity and segments live — this
              card is a summary, not the authority.
            </p>
          )}
        </>
      )}

      {saved && (
        <div className="mt-5 rounded-xl border border-emerald-400/25 bg-emerald-400/[0.07] p-4">
          <p className="text-sm font-semibold text-emerald-300">
            Swapped — now {saved.after}. {rupees(view.amountPaid)} unchanged.
          </p>
          {saved.addedDates.length > 0 && (
            <p className="mt-1 text-xs text-gray-400">
              Added attendance keys for {saved.addedDates.map(dayLabel).join(', ')}.
            </p>
          )}
          <p className="mt-2 text-xs leading-relaxed text-gray-400">
            The Google Sheet updates itself on the next sync (within 10 minutes) — nothing to do
            there. The confirmation email in their inbox is now stale.
          </p>
          <button type="button" onClick={() => void doResend()} disabled={resending || busy} className={`${ghostButton} mt-3`}>
            {resending ? 'Sending…' : 'Resend ticket email'}
          </button>
          {resentAt && <span className="ml-3 text-xs text-emerald-300">Sent {new Date(resentAt).toLocaleString()}</span>}
        </div>
      )}

      {!saved && view.editable && (
        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-hairline pt-4">
          <button type="button" onClick={() => void doResend()} disabled={resending || busy} className={ghostButton}>
            {resending ? 'Sending…' : 'Resend ticket email'}
          </button>
          <span className="text-xs text-gray-500">
            {view.emailSentAt
              ? `Last sent ${new Date(view.emailSentAt).toLocaleString()}`
              : 'No ticket email on record — a paid row without one means it never went out.'}
          </span>
        </div>
      )}
    </div>
  );
}
