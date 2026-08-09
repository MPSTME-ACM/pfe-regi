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
  'w-full bg-white/5 border border-white/20 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#f8c8fc] transition-all';
const label = 'block text-sm font-medium text-gray-300 mb-1';

function Field({ children, hint, text }: { children: React.ReactNode; hint?: string; text: string }) {
  return (
    <div className="mb-4">
      <span className={label}>{text}</span>
      {children}
      {hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
    </div>
  );
}

/** Rupees in the UI, paise on the wire. Keeps the admin from typing 25000 for ₹250. */
function RupeeInput({ paise, onChange }: { paise: number; onChange: (paise: number) => void }) {
  const [text, setText] = useState((paise / 100).toString());
  useEffect(() => setText((paise / 100).toString()), [paise]);

  return (
    <div className="flex items-center gap-2">
      <span className="text-gray-400">₹</span>
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
        className={input}
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
      className={`${input} font-mono text-sm`}
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
      <main className="min-h-screen bg-gray-900 text-white p-8">
        {status.kind === 'error' ? (
          <p className="text-red-400">{status.message}</p>
        ) : (
          <p className="text-gray-400">Loading settings…</p>
        )}
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-900 text-white">
      <div className="max-w-4xl mx-auto p-6 sm:p-8">
        <header className="flex items-start justify-between mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-bold">PFE Admin</h1>
            <p className="text-gray-400 text-sm mt-1">
              Changes apply immediately on save. No deploy required.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href="/stats"
              className="text-sm text-gray-300 hover:text-white bg-black/30 px-3 py-2 rounded-lg border border-white/10"
            >
              Stats
            </Link>
            <Link
              href="/sync"
              className="text-sm text-gray-300 hover:text-white bg-black/30 px-3 py-2 rounded-lg border border-white/10"
            >
              Sync
            </Link>
            <button
              onClick={logout}
              className="text-sm text-gray-300 hover:text-white bg-black/30 px-3 py-2 rounded-lg border border-white/10"
            >
              Logout
            </button>
          </div>
        </header>

        {/* Registration status is the thing you came here to check. Always visible. */}
        <div
          className={`mb-8 rounded-xl border p-4 flex items-center justify-between gap-4 ${
            settings?.registrationOpen
              ? 'border-green-500/40 bg-green-500/10'
              : 'border-red-500/40 bg-red-500/10'
          }`}
        >
          <div>
            <p className="font-semibold">
              Registration is {settings?.registrationOpen ? 'OPEN' : 'CLOSED'}
            </p>
            <p className="text-sm text-gray-400">
              {settings?.registrationOpen
                ? 'The public form is live and accepting submissions.'
                : 'Visitors see the closed message. The API rejects new orders.'}
            </p>
          </div>
          <button
            onClick={toggleRegistration}
            disabled={toggling}
            className={`shrink-0 font-bold px-4 py-2 rounded-lg transition disabled:opacity-50 ${
              draft.registrationOpen
                ? 'bg-red-500/80 hover:bg-red-500 text-white'
                : 'bg-green-500/80 hover:bg-green-500 text-black'
            }`}
          >
            {toggling
              ? 'Saving…'
              : draft.registrationOpen
                ? 'Close registration'
                : 'Open registration'}
          </button>
        </div>

        <nav className="flex flex-wrap gap-1 border-b border-white/10 mb-6">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm rounded-t-lg transition ${
                tab === t.id
                  ? 'bg-white/10 text-white border-b-2 border-[#e97bfc]'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              {t.label}
              {t.phase && <span className="ml-2 text-[10px] text-gray-500">{t.phase}</span>}
            </button>
          ))}
        </nav>

        {tab === 'registration' && (
          <section>
            <p className="text-sm text-gray-400 mb-4">
              Shown on the home page while registration is closed.
            </p>
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
                className={input}
                value={draft.closedBody}
                onChange={(e) => patch({ closedBody: e.target.value })}
              />
            </Field>
          </section>
        )}

        {tab === 'pricing' && (
          <section>
            <p className="text-sm text-gray-400 mb-4">
              Stored in paise. Saved here now, but{' '}
              <strong className="text-yellow-400/90">not yet what gets charged</strong> — the live
              amount still comes from the <code className="text-xs">ORDER_AMOUNT</code> environment
              variable. Phase 2 introduces the three-SKU model and makes these authoritative.
            </p>
            <Field text="Capstone day only">
              <RupeeInput paise={draft.priceCapstone} onChange={(v) => patch({ priceCapstone: v })} />
            </Field>
            <Field text="Single track" hint="One track, both of its days.">
              <RupeeInput paise={draft.priceSingle} onChange={(v) => patch({ priceSingle: v })} />
            </Field>
            <Field text="Bundle" hint="One beginner track + one advanced track + capstone day.">
              <RupeeInput paise={draft.priceBundle} onChange={(v) => patch({ priceBundle: v })} />
            </Field>
            <p className="text-xs text-gray-500 mt-6">
              ACM member pricing is delivered as coupons, not a separate price list. That tab lands in
              phase 3.
            </p>
          </section>
        )}

        {tab === 'event' && (
          <section>
            <p className="text-sm text-gray-400 mb-4">
              Used on the form and in the confirmation email.
            </p>
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
            <Field text="Venue">
              <input
                className={input}
                value={draft.eventConfig.venue}
                onChange={(e) => patchEvent({ venue: e.target.value })}
              />
            </Field>
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
            <p className="text-xs text-gray-500 mt-6">
              The confirmation email still carries these values in its compiled HTML. Phase 2 wires it
              to read from here.
            </p>
          </section>
        )}

        {tab === 'fields' && (
          <section>
            <p className="text-sm text-gray-400 mb-4">One option per line. Order is preserved.</p>
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
          <section className="text-gray-400 text-sm border border-dashed border-white/15 rounded-xl p-8 text-center">
            <p className="font-medium text-gray-300 mb-1">Not built yet</p>
            <p>Coupon generation, redemption log and the referrer leaderboard arrive in phase 3.</p>
          </section>
        )}

        <div className="sticky bottom-0 mt-10 -mx-6 sm:-mx-8 px-6 sm:px-8 py-4 bg-gray-900/95 backdrop-blur border-t border-white/10 flex flex-wrap items-center gap-4">
          <button
            onClick={barSave}
            disabled={!barDirty || barStatus.kind === 'saving'}
            className="bg-[#e97bfc] text-black font-bold px-5 py-2.5 rounded-lg transition hover:shadow-lg hover:shadow-[#e97bfc]/40 disabled:opacity-40 disabled:hover:shadow-none"
          >
            {barStatus.kind === 'saving' ? 'Saving…' : onTracks ? 'Save tracks' : 'Save changes'}
          </button>
          {barDirty && (
            <button onClick={barDiscard} className="text-sm text-gray-400 hover:text-white">
              Discard
            </button>
          )}
          {!barDirty && barStatus.kind === 'ok' && <span className="text-sm text-green-400">Saved</span>}
          {barStatus.kind === 'error' && (
            <span className="text-sm text-red-400">{barStatus.message}</span>
          )}
          {elsewhereDirty && (
            <span className="text-xs text-yellow-400/90">
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
