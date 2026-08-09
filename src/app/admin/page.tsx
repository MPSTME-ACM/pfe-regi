'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import AdminGate, { clearStoredCreds } from '@/components/admin/AdminGate';
import type { EventConfig, FieldOptions, Settings } from '@/lib/db/schema';

// ─────────────────────────────────────────────────────────────────────────────
// Admin panel.
//
// Phase 1 covers the Registration tab (the open/close switch that replaced the
// rename-five-files-and-commit ritual) plus prices, event copy and form options.
// Tracks / Coupons / Referrers arrive in phases 2 and 3 — their tabs are stubbed
// so the shape of the panel is visible now.
// ─────────────────────────────────────────────────────────────────────────────

type TabId = 'registration' | 'pricing' | 'event' | 'fields' | 'tracks' | 'coupons';

const TABS: { id: TabId; label: string; phase?: string }[] = [
  { id: 'registration', label: 'Registration' },
  { id: 'pricing', label: 'Pricing' },
  { id: 'event', label: 'Event details' },
  { id: 'fields', label: 'Form fields' },
  { id: 'tracks', label: 'Tracks', phase: 'Phase 2' },
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

  const dirty = !!settings && !!draft && JSON.stringify(settings) !== JSON.stringify(draft);

  const save = async () => {
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
            onClick={() => patch({ registrationOpen: !draft.registrationOpen })}
            className={`shrink-0 font-bold px-4 py-2 rounded-lg transition ${
              draft.registrationOpen
                ? 'bg-red-500/80 hover:bg-red-500 text-white'
                : 'bg-green-500/80 hover:bg-green-500 text-black'
            }`}
          >
            {draft.registrationOpen ? 'Close registration' : 'Open registration'}
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

        {(tab === 'tracks' || tab === 'coupons') && (
          <section className="text-gray-400 text-sm border border-dashed border-white/15 rounded-xl p-8 text-center">
            <p className="font-medium text-gray-300 mb-1">Not built yet</p>
            <p>
              {tab === 'tracks'
                ? 'Track list, per-track capacity and dates arrive with the phase 2 schema change.'
                : 'Coupon generation, redemption log and the referrer leaderboard arrive in phase 3.'}
            </p>
          </section>
        )}

        <div className="sticky bottom-0 mt-10 -mx-6 sm:-mx-8 px-6 sm:px-8 py-4 bg-gray-900/95 backdrop-blur border-t border-white/10 flex items-center gap-4">
          <button
            onClick={save}
            disabled={!dirty || status.kind === 'saving'}
            className="bg-[#e97bfc] text-black font-bold px-5 py-2.5 rounded-lg transition hover:shadow-lg hover:shadow-[#e97bfc]/40 disabled:opacity-40 disabled:hover:shadow-none"
          >
            {status.kind === 'saving' ? 'Saving…' : 'Save changes'}
          </button>
          {dirty && (
            <button
              onClick={() => {
                setDraft(settings);
                setStatus({ kind: 'idle' });
              }}
              className="text-sm text-gray-400 hover:text-white"
            >
              Discard
            </button>
          )}
          {!dirty && status.kind === 'ok' && <span className="text-sm text-green-400">Saved</span>}
          {status.kind === 'error' && <span className="text-sm text-red-400">{status.message}</span>}
        </div>
      </div>
    </main>
  );
}

export default function AdminPage() {
  return <AdminGate title="PFE Admin">{({ creds, logout }) => <Panel creds={creds} logout={logout} />}</AdminGate>;
}
