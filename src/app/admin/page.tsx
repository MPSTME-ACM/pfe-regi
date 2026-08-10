'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import AdminGate, { clearStoredCreds } from '@/components/admin/AdminGate';
import { TracksTab, useTracksEditor } from '@/components/admin/TracksTab';
import type { EventConfig, FieldOptions, Settings } from '@/lib/db/schema';

// ─────────────────────────────────────────────────────────────────────────────
// Admin panel.
//
// The Registration tab holds the open/close switch that replaced the
// rename-five-files-and-commit ritual; the rest are prices, event copy, form
// options and the track roster. Coupons / referrers arrive in phase 3 — that tab
// is stubbed so the shape of the panel is visible now.
//
// Two independent editors share one sticky save bar: the settings draft (four
// tabs, one PATCH to /api/admin/settings) and the tracks draft (one PATCH to
// /api/admin/tracks). The bar acts on whichever the current tab owns, and warns
// when the other has unsaved work rather than silently dropping it.
//
// No opaque page background. `layout.tsx` renders the animated <Background />
// behind everything, and the old `bg-gray-900` painted straight over it — which
// made the panel the one surface in the product that did not look like the
// product. Reading order is: status banner (sitting directly on the background,
// so it reads as a heads-up display), then the tab strip, then a single
// translucent card holding whichever editor is open.
// ─────────────────────────────────────────────────────────────────────────────

type TabId = 'registration' | 'pricing' | 'event' | 'fields' | 'tracks' | 'coupons';

const TABS: { id: TabId; label: string; phase?: string }[] = [
  { id: 'registration', label: 'Registration' },
  { id: 'pricing', label: 'Pricing' },
  { id: 'event', label: 'Event details' },
  { id: 'fields', label: 'Form fields' },
  { id: 'tracks', label: 'Tracks' },
  { id: 'coupons', label: 'Coupons', phase: 'Phase 3' },
];

const input =
  'w-full bg-white/5 border border-white/20 rounded-lg px-4 py-3 text-white placeholder-gray-500 ' +
  'outline-none transition-[border-color,background-color,box-shadow] duration-200 ' +
  'hover:border-white/30 focus:border-transparent focus:ring-2 focus:ring-accent-soft';
const label = 'block text-xs font-medium uppercase tracking-wider text-gray-400 mb-1.5';

/** Header link-buttons. Sized for a thumb, not a mouse. */
const chip =
  'inline-flex items-center justify-center min-h-[44px] px-3.5 rounded-lg text-sm text-gray-300 ' +
  'bg-white/[0.04] border border-white/10 transition-colors hover:bg-white/10 hover:text-white ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-soft';

function Field({
  children,
  hint,
  text,
  badge,
}: {
  children: React.ReactNode;
  hint?: string;
  text: string;
  /** Small marker beside the label. Emphasis only — never a status. */
  badge?: string;
}) {
  // Deliberately no `last:mb-0`. Inside the two-column grids on the Event tab a
  // Field can be the grid's last child, so at <640px (one column) it would lose
  // its bottom margin and the following label would sit flush against its input.
  return (
    <div className="mb-5">
      {badge ? (
        <span className={`${label} flex items-center gap-2`}>
          {text}
          <span className="rounded border border-accent/30 bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-accent-soft">
            {badge}
          </span>
        </span>
      ) : (
        <span className={label}>{text}</span>
      )}
      {children}
      {hint && <p className="mt-1.5 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

/** The sentence that opens a tab. Sets context, then gets out of the way. */
function Lead({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-6 max-w-[68ch] border-b border-white/10 pb-5 text-sm leading-relaxed text-gray-400">
      {children}
    </p>
  );
}

/** Rupees in the UI, paise on the wire. Keeps the admin from typing 25000 for ₹250. */
function RupeeInput({ paise, onChange }: { paise: number; onChange: (paise: number) => void }) {
  const [text, setText] = useState((paise / 100).toString());
  useEffect(() => setText((paise / 100).toString()), [paise]);

  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-gray-400">
        ₹
      </span>
      <input
        type="number"
        min={0}
        step="1"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const rupees = Number(e.target.value);
          if (Number.isFinite(rupees) && rupees >= 0) onChange(Math.round(rupees * 100));
        }}
        className={`${input} pl-9 tabular-nums`}
      />
    </div>
  );
}

/** One option per line — far easier to edit than a tag widget, and it round-trips. */
function ListEditor({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <textarea
      rows={Math.min(14, Math.max(4, value.length + 1))}
      value={value.join('\n')}
      onChange={(e) => onChange(e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))}
      className={`${input} font-mono text-sm leading-relaxed`}
    />
  );
}

function Panel({ creds, logout }: { creds: string; logout: () => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [tab, setTab] = useState<TabId>('registration');
  const [status, setStatus] = useState<{ kind: 'idle' | 'saving' | 'ok' | 'error'; message?: string }>({
    kind: 'idle',
  });

  const tracksEditor = useTracksEditor(creds, tab === 'tracks');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/settings', { headers: { Authorization: creds } });
      if (res.status === 401) {
        clearStoredCreds();
        window.location.reload();
        return;
      }
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || 'Failed to load settings');
      setSettings(data.settings);
      setDraft(data.settings);
    } catch (e) {
      setStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, [creds]);

  useEffect(() => {
    load();
  }, [load]);

  const settingsDirty = !!settings && !!draft && JSON.stringify(settings) !== JSON.stringify(draft);

  const saveSettings = async () => {
    if (!draft) return;
    setStatus({ kind: 'saving' });
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { Authorization: creds, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          registrationOpen: draft.registrationOpen,
          closedTitle: draft.closedTitle,
          closedBody: draft.closedBody,
          priceCapstone: draft.priceCapstone,
          priceSingle: draft.priceSingle,
          priceBundle: draft.priceBundle,
          eventConfig: draft.eventConfig,
          fieldOptions: draft.fieldOptions,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || 'Save failed');
      setSettings(data.settings);
      setDraft(data.settings);
      setStatus({ kind: 'ok', message: 'Saved' });
    } catch (e) {
      setStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  const [toggling, setToggling] = useState(false);

  /**
   * Open/close applies IMMEDIATELY, on its own PATCH.
   *
   * It used to write into the settings draft and wait for the sticky save bar.
   * That bar became tab-scoped when the Tracks tab landed, so pressing Save while
   * on Tracks saved the track roster, reported a green "Saved", and never
   * transmitted registrationOpen at all — leaving the banner reading OPEN while
   * the button beneath it read "Open registration", and the public form still
   * taking paid orders. Neither change was wrong on its own; the toggle sits
   * above the tabs and belongs to no tab, which is exactly why it must not
   * depend on one.
   *
   * Other pending settings edits are preserved: only this one field is patched.
   */
  const toggleRegistration = async () => {
    if (!draft || toggling) return;
    const next = !draft.registrationOpen;
    setToggling(true);
    setStatus({ kind: 'saving' });
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { Authorization: creds, 'Content-Type': 'application/json' },
        body: JSON.stringify({ registrationOpen: next }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || 'Failed to change registration');
      setSettings(data.settings);
      setDraft((d) => (d ? { ...d, registrationOpen: data.settings.registrationOpen } : d));
      setStatus({ kind: 'ok', message: next ? 'Registration opened' : 'Registration closed' });
    } catch (e) {
      setStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setToggling(false);
    }
  };

  // The save bar belongs to whichever editor the current tab owns.
  const onTracks = tab === 'tracks';
  const barDirty = onTracks ? tracksEditor.dirty : settingsDirty;
  const barStatus = onTracks ? tracksEditor.status : status;
  const barSave = onTracks ? tracksEditor.save : saveSettings;
  const barDiscard = onTracks
    ? tracksEditor.discard
    : () => {
      setDraft(settings);
      setStatus({ kind: 'idle' });
    };
  // Edits on the tab you are not looking at are still pending. Say so — the
  // alternative is an admin who saves prices and assumes their capacity change
  // went with it.
  const elsewhereDirty = onTracks ? settingsDirty : tracksEditor.dirty;

  const patch = (p: Partial<Settings>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const patchEvent = (p: Partial<EventConfig>) =>
    setDraft((d) => (d ? { ...d, eventConfig: { ...d.eventConfig, ...p } } : d));
  const patchFields = (p: Partial<FieldOptions>) =>
    setDraft((d) => (d ? { ...d, fieldOptions: { ...d.fieldOptions, ...p } } : d));

  if (!draft) {
    return (
      <main className="min-h-screen text-white flex items-start justify-center px-5 py-16 sm:px-8">
        <div className="w-full max-w-4xl rounded-2xl border border-white/10 bg-black/30 p-6 backdrop-blur-md">
          {status.kind === 'error' ? (
            <p className="text-red-300">{status.message}</p>
          ) : (
            <p className="text-gray-400">Loading settings…</p>
          )}
        </div>
      </main>
    );
  }

  const open = !!settings?.registrationOpen;

  return (
    <main className="min-h-screen text-white">
      {/* The horizontal padding here is load-bearing: the sticky save bar cancels
          it with a matching negative margin. Change one, change the other. */}
      <div className="mx-auto max-w-4xl px-5 pt-8 sm:px-8 sm:pt-12">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-3xl font-bold tracking-tight text-accent-soft sm:text-4xl">PFE Admin</h1>
            <p className="mt-1.5 text-sm text-gray-400">
              Changes apply immediately on save. No deploy required.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link href="/stats" className={chip}>
              Stats
            </Link>
            <Link href="/sync" className={chip}>
              Sync
            </Link>
            <button onClick={logout} className={chip}>
              Logout
            </button>
          </div>
        </header>

        {/* Registration status is the thing you came here to check. It stays out
            of the editor card and carries the largest type on the page: loudest
            by scale, not by saturation. */}
        <section
          className={`mt-8 flex flex-col gap-5 rounded-2xl border p-5 backdrop-blur-md sm:mt-10 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:p-6 ${open
            ? 'border-emerald-400/25 bg-emerald-400/[0.07]'
            : 'border-red-400/30 bg-red-500/[0.09]'
            }`}
        >
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xl font-semibold tracking-tight sm:text-2xl">
              <span
                aria-hidden
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${open
                  ? 'bg-emerald-400 shadow-[0_0_0_4px_rgba(52,211,153,0.16)]'
                  : 'bg-red-400 shadow-[0_0_0_4px_rgba(248,113,113,0.16)]'
                  }`}
              />
              <span className="text-gray-300">Registration is</span>
              <span className={open ? 'text-emerald-300' : 'text-red-300'}>
                {open ? 'OPEN' : 'CLOSED'}
              </span>
            </p>
            <p className="mt-2 max-w-[52ch] text-sm leading-relaxed text-gray-400">
              {open
                ? 'The public form is live and accepting submissions.'
                : 'Visitors see the closed message. The API rejects new orders.'}
            </p>
          </div>
          {/* Applies on click, on its own PATCH — never through the save bar. */}
          <button
            onClick={toggleRegistration}
            disabled={toggling}
            className={`min-h-[44px] w-full shrink-0 rounded-lg px-5 font-bold transition-[background-color,border-color,box-shadow,transform,opacity] duration-200 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:scale-[0.99] disabled:opacity-50 disabled:active:scale-100 sm:w-auto ${draft.registrationOpen
              ? 'border border-red-400/40 bg-red-500/15 text-red-200 hover:border-red-400/60 hover:bg-red-500/25'
              : 'bg-accent text-black hover:shadow-lg hover:shadow-accent/30'
              }`}
          >
            {toggling
              ? 'Saving…'
              : draft.registrationOpen
                ? 'Close registration'
                : 'Open registration'}
          </button>
        </section>

        {/* Scrolls sideways inside itself on a narrow screen rather than wrapping
            into three ragged rows. The page itself never scrolls horizontally. */}
        <div className="-mx-5 mt-8 overflow-x-auto px-5 [scrollbar-width:none] sm:-mx-8 sm:mt-10 sm:px-8 [&::-webkit-scrollbar]:hidden">
          <nav className="flex w-max gap-1 rounded-xl border border-white/10 bg-black/40 p-1.5 backdrop-blur-md">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? 'page' : undefined}
                className={`inline-flex min-h-[44px] items-center gap-2 whitespace-nowrap rounded-lg px-3.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-soft ${tab === t.id
                  ? 'bg-accent/15 font-semibold text-accent-soft shadow-[inset_0_0_0_1px_rgba(233,123,252,0.3)]'
                  : 'text-gray-400 hover:bg-white/[0.06] hover:text-white'
                  }`}
              >
                {t.label}
                {t.phase && (
                  <span className="text-[10px] uppercase tracking-wider text-gray-500">{t.phase}</span>
                )}
              </button>
            ))}
          </nav>
        </div>

        {/* bg-black/40, matching AdminGate's card rather than the /30 used on the
            marketing surfaces: this one carries dense grey-on-dark form text, and
            the animated ray behind it washes /30 out where it crosses. */}
        <div className="mt-4 rounded-2xl border border-white/10 bg-black/40 p-5 backdrop-blur-md sm:p-7">
          {tab === 'registration' && (
            <section>
              <Lead>Shown on the home page while registration is closed.</Lead>
              <Field text="Closed heading">
                <input
                  className={input}
                  value={draft.closedTitle}
                  onChange={(e) => patch({ closedTitle: e.target.value })}
                />
              </Field>
              <Field text="Closed body">
                <textarea
                  rows={3}
                  className={`${input} leading-relaxed`}
                  value={draft.closedBody}
                  onChange={(e) => patch({ closedBody: e.target.value })}
                />
              </Field>
            </section>
          )}

          {tab === 'pricing' && (
            <section>
              <Lead>
                Stored in paise. Saved here now, but{' '}
                <strong className="font-semibold text-amber-300">not yet what gets charged</strong> —
                the live amount still comes from the{' '}
                <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs text-gray-300">
                  ORDER_AMOUNT
                </code>{' '}
                environment variable. Phase 2 introduces the three-SKU model and makes these
                authoritative.
              </Lead>
              <div className="max-w-md">
                <Field text="Single track" hint="One track, both of its days.">
                  <RupeeInput paise={draft.priceSingle} onChange={(v) => patch({ priceSingle: v })} />
                </Field>
                {/* Bundle is the headline SKU — two tracks plus the capstone day.
                    Tinted rather than boxed-out: enough to catch the eye scanning
                    the column, quiet enough that the status banner still wins. */}
                <div className="mb-5 rounded-xl border border-accent/25 bg-accent/[0.06] p-4 [&>div]:mb-0">
                  <Field
                    text="Bundle"
                    badge="Best value"
                    hint="One beginner track + one advanced track + capstone day."
                  >
                    <RupeeInput paise={draft.priceBundle} onChange={(v) => patch({ priceBundle: v })} />
                  </Field>
                </div>
                <Field text="Capstone day only">
                  <RupeeInput paise={draft.priceCapstone} onChange={(v) => patch({ priceCapstone: v })} />
                </Field>
              </div>
              <p className="mt-6 border-t border-white/10 pt-5 text-xs leading-relaxed text-gray-500">
                ACM member pricing is delivered as coupons, not a separate price list. That tab lands
                in phase 3.
              </p>
            </section>
          )}

          {tab === 'event' && (
            <section>
              <Lead>Used on the form and in the confirmation email.</Lead>
              <div className="grid gap-x-6 sm:grid-cols-2">
                <Field text="Dates">
                  <input
                    className={input}
                    value={draft.eventConfig.dateRange}
                    onChange={(e) => patchEvent({ dateRange: e.target.value })}
                  />
                </Field>
                <Field text="Time">
                  <input
                    className={input}
                    value={draft.eventConfig.timeRange}
                    onChange={(e) => patchEvent({ timeRange: e.target.value })}
                  />
                </Field>
              </div>
              <Field text="Venue">
                <input
                  className={input}
                  value={draft.eventConfig.venue}
                  onChange={(e) => patchEvent({ venue: e.target.value })}
                />
              </Field>
              <div className="grid gap-x-6 sm:grid-cols-2">
                <Field text="Contact email">
                  <input
                    className={input}
                    value={draft.eventConfig.contactEmail}
                    onChange={(e) => patchEvent({ contactEmail: e.target.value })}
                  />
                </Field>
                <Field text="WhatsApp support URL">
                  <input
                    className={input}
                    value={draft.eventConfig.whatsappUrl}
                    onChange={(e) => patchEvent({ whatsappUrl: e.target.value })}
                  />
                </Field>
              </div>
              <p className="mt-6 border-t border-white/10 pt-5 text-xs leading-relaxed text-gray-500">
                The confirmation email still carries these values in its compiled HTML. Phase 2 wires
                it to read from here.
              </p>
            </section>
          )}

          {tab === 'fields' && (
            <section>
              <Lead>One option per line. Order is preserved.</Lead>
              <Field text="Colleges" hint="Keep an 'Other' entry — it drives the free-text fallback.">
                <ListEditor
                  value={draft.fieldOptions.colleges}
                  onChange={(v) => patchFields({ colleges: v })}
                />
              </Field>
              <Field text="Courses">
                <ListEditor
                  value={draft.fieldOptions.courses}
                  onChange={(v) => patchFields({ courses: v })}
                />
              </Field>
              <Field text="Departments">
                <ListEditor
                  value={draft.fieldOptions.departments}
                  onChange={(v) => patchFields({ departments: v })}
                />
              </Field>
              <Field text="Academic years">
                <ListEditor value={draft.fieldOptions.years} onChange={(v) => patchFields({ years: v })} />
              </Field>
            </section>
          )}

          {tab === 'tracks' && <TracksTab editor={tracksEditor} />}

          {tab === 'coupons' && (
            <section className="rounded-xl border border-dashed border-white/15 px-6 py-14 text-center">
              <p className="text-base font-semibold text-gray-300">Not built yet</p>
              <p className="mx-auto mt-2 max-w-[46ch] text-sm leading-relaxed text-gray-500">
                Coupon generation, redemption log and the referrer leaderboard arrive in phase 3.
              </p>
            </section>
          )}
        </div>

        {/* Heavier than the card language on purpose: this bar floats over live
            text, where card-weight translucency turns the button label to mud. */}
        <div className="sticky bottom-0 -mx-5 mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-t-2xl border-t border-white/10 bg-black/70 px-5 py-4 backdrop-blur-xl sm:-mx-8 sm:px-8">
          <button
            onClick={barSave}
            disabled={!barDirty || barStatus.kind === 'saving'}
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-accent px-5 font-bold text-black transition-[box-shadow,transform,opacity] duration-200 ease-out hover:shadow-lg hover:shadow-accent/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:scale-[0.99] disabled:opacity-40 disabled:hover:shadow-none disabled:active:scale-100"
          >
            {barStatus.kind === 'saving' ? 'Saving…' : onTracks ? 'Save tracks' : 'Save changes'}
          </button>
          {barDirty && (
            <button
              onClick={barDiscard}
              className="inline-flex min-h-[44px] items-center justify-center rounded-lg px-3 text-sm text-gray-400 transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-soft"
            >
              Discard
            </button>
          )}
          {!barDirty && barStatus.kind === 'ok' && (
            <span className="text-sm font-medium text-emerald-300">Saved</span>
          )}
          {barStatus.kind === 'error' && (
            <span className="text-sm text-red-300">{barStatus.message}</span>
          )}
          {elsewhereDirty && (
            <span className="text-xs leading-snug text-amber-300/90">
              Unsaved changes on the {onTracks ? 'settings tabs' : 'Tracks tab'} — this button does
              not save them.
            </span>
          )}
        </div>
      </div>
    </main>
  );
}

export default function AdminPage() {
  return <AdminGate title="PFE Admin">{({ creds, logout }) => <Panel creds={creds} logout={logout} />}</AdminGate>;
}
