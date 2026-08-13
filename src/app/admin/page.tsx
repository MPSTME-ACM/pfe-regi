'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import AdminGate, { clearStoredCreds } from '@/components/admin/AdminGate';
import { SyncStaleBanner, useSyncHistory } from '@/components/admin/SyncStatus';
import { TracksTab, useTracksEditor } from '@/components/admin/TracksTab';
import { CouponsTab, useCouponsEditor } from '@/components/admin/CouponsTab';
import type { EventConfig, FieldOptions, FieldLabels, FieldText, Settings } from '@/lib/db/schema';

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
// OPAQUE surfaces, unlike the public pages. `Background` returns null on the
// staff routes, so there is nothing behind these panels: a flickering grid and a
// drifting blurred ray are the brand on the registration form and noise behind a
// table of numbers. Reading order is status banner, tab strip, then one card
// holding whichever editor is open.
// ─────────────────────────────────────────────────────────────────────────────

type TabId = 'registration' | 'pricing' | 'event' | 'fields' | 'tracks' | 'coupons';

const TABS: { id: TabId; label: string; phase?: string }[] = [
  { id: 'registration', label: 'Registration' },
  { id: 'pricing', label: 'Pricing' },
  { id: 'event', label: 'Event details' },
  { id: 'fields', label: 'Form fields' },
  { id: 'tracks', label: 'Tracks' },
  { id: 'coupons', label: 'Coupons' },
];

const input =
  'w-full bg-white/5 border border-hairline rounded-lg px-4 py-3 text-white placeholder-gray-500 ' +
  'outline-none transition-[border-color,background-color,box-shadow] duration-200 ' +
  'hover:border-white/30 focus:border-transparent focus:ring-2 focus:ring-accent-soft';
const label = 'block text-xs font-medium uppercase tracking-wider text-gray-300 mb-1.5';

/** Header link-buttons. Sized for a thumb, not a mouse. */
const chip =
  'inline-flex items-center justify-center min-h-[44px] px-3.5 rounded-lg text-sm text-gray-300 ' +
  'bg-white/[0.04] border border-hairline transition-colors hover:bg-white/10 hover:text-white ' +
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
      {hint && <p className="mt-1.5 text-xs text-gray-400">{hint}</p>}
    </div>
  );
}

/** The sentence that opens a tab. Sets context, then gets out of the way. */
/**
 * Which form fields are editable, in the order they appear on the form.
 *
 * `control` decides how many boxes a row shows, not what the field does. Only
 * `course` and `department` are `both`: they render as a dropdown for a known
 * college and as free text once "Other" is picked, so they need a separate hint
 * for each. See FieldText in db/schema.
 */
const FIELD_ROWS: { key: keyof FieldLabels; control: 'text' | 'select' | 'both'; hint?: string }[] = [
  { key: 'name', control: 'text' },
  { key: 'email', control: 'text' },
  { key: 'contact', control: 'text' },
  { key: 'college', control: 'select', hint: 'Options are edited below.' },
  { key: 'course', control: 'both', hint: 'Stored in the `course` column. Options are edited below.' },
  { key: 'department', control: 'both', hint: 'Stored in the `department` column. Options are edited below.' },
  { key: 'year', control: 'select', hint: 'Options are edited below.' },
  { key: 'referral', control: 'text' },
];

/**
 * One field's wording. The data key is shown as a fixed monospace tag beside the
 * inputs, because the whole point of this screen is that the label can be
 * anything while the column it writes to cannot — an admin renaming "Course" to
 * "Programme" needs to see that it is still `course` underneath.
 */
function WordingRow({
  fieldKey,
  control,
  hint,
  value,
  onChange,
}: {
  fieldKey: string;
  control: 'text' | 'select' | 'both';
  hint?: string;
  value: FieldText;
  onChange: (patch: Partial<FieldText>) => void;
}) {
  const placeholderLabel = control === 'select' ? 'Unselected prompt' : 'Placeholder';

  return (
    <div className="rounded-xl border border-hairline bg-white/[0.02] p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <code className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-xs text-accent-soft">
          {fieldKey}
        </code>
        {hint && <span className="text-right text-[11px] leading-tight text-gray-500">{hint}</span>}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <span className={label}>Label</span>
          <input
            className={input}
            value={value.label}
            onChange={(e) => onChange({ label: e.target.value })}
          />
        </div>
        <div>
          <span className={label}>{placeholderLabel}</span>
          <input
            className={input}
            value={value.placeholder}
            onChange={(e) => onChange({ placeholder: e.target.value })}
          />
        </div>
        {control === 'both' && (
          <div className="sm:col-span-2">
            <span className={label}>Unselected prompt (dropdown mode)</span>
            <input
              className={input}
              value={value.selectPrompt ?? ''}
              placeholder="Select your option"
              onChange={(e) => onChange({ selectPrompt: e.target.value })}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function Lead({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-6 max-w-[68ch] border-b border-hairline pb-5 text-sm leading-relaxed text-gray-400">
      {children}
    </p>
  );
}

/**
 * Rupees in the UI, paise on the wire. Keeps the admin from typing 25000 for ₹250.
 *
 * Tolerates being empty mid-edit, which the naive version did not: `Number('')`
 * is 0, and 0 passes both `isFinite` and `>= 0`, so selecting-all and deleting
 * in order to retype a price pushed **₹0** up to the draft. Tab away at that
 * moment and the save bar would have written a free ticket. An empty box now
 * holds the last good value until a real number is typed.
 */
function RupeeInput({ paise, onChange }: { paise: number; onChange: (paise: number) => void }) {
  const [text, setText] = useState(() => (paise / 100).toString());
  useEffect(() => {
    // Only re-sync when the draft genuinely moved elsewhere (a save, a discard),
    // otherwise this fights the keystroke that is being typed.
    setText((current) => (Math.round(Number(current) * 100) === paise ? current : (paise / 100).toString()));
  }, [paise]);

  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-gray-400">
        ₹
      </span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        step="1"
        value={text}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          if (next.trim() === '') return; // mid-edit, not "free"
          const rupees = Number(next);
          if (Number.isFinite(rupees) && rupees >= 0) onChange(Math.round(rupees * 100));
        }}
        onBlur={() => {
          // Leaving the field empty is not a price. Put the real value back.
          if (text.trim() === '') setText((paise / 100).toString());
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
  const couponsEditor = useCouponsEditor(creds, tab === 'coupons');
  // Not tab-scoped: a dead sheet sync is worth knowing about from any tab.
  const syncStatus = useSyncHistory(creds);

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

  /**
   * Coupons has no save bar at all.
   *
   * Every coupon write applies on its own request the moment you make it, like
   * the open/close toggle — there is no draft to save. Leaving the bar visible
   * here would put an enabled "Save changes" on a tab where nothing is savable,
   * and pressing it would PATCH the *settings* draft, which is the exact
   * wrong-editor failure CLAUDE.md lists as a landmine. Unsaved work on the
   * other tabs is still surfaced below, just without a button that lies about
   * what it does.
   */
  const onCoupons = tab === 'coupons';

  // Otherwise the save bar belongs to whichever editor the current tab owns.
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
  // Edits on a tab you are not looking at are still pending. Say so — the
  // alternative is an admin who saves prices and assumes their capacity change
  // went with it. On Coupons neither other editor is the bar's, so both can be
  // outstanding simultaneously and both need naming.
  const pendingElsewhere = [
    !onTracks && tracksEditor.dirty ? 'the Tracks tab' : null,
    onTracks || onCoupons ? (settingsDirty ? 'the settings tabs' : null) : null,
  ].filter((s): s is string => s !== null);

  // The bar earns its space or it does not appear.
  const showBar =
    pendingElsewhere.length > 0 ||
    (!onCoupons && (barDirty || barStatus.kind === 'saving' || barStatus.kind === 'ok' || barStatus.kind === 'error'));

  const patch = (p: Partial<Settings>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const patchEvent = (p: Partial<EventConfig>) =>
    setDraft((d) => (d ? { ...d, eventConfig: { ...d.eventConfig, ...p } } : d));
  const patchFields = (p: Partial<FieldOptions>) =>
    setDraft((d) => (d ? { ...d, fieldOptions: { ...d.fieldOptions, ...p } } : d));
  /** Merge into ONE field's wording. Keys are column names and never change. */
  const patchLabel = (key: keyof FieldLabels, p: Partial<FieldText>) =>
    setDraft((d) =>
      d ? { ...d, fieldLabels: { ...d.fieldLabels, [key]: { ...d.fieldLabels[key], ...p } } } : d,
    );

  if (!draft) {
    return (
      <main className="min-h-screen bg-panel text-white flex items-start justify-center px-5 py-16 sm:px-8">
        <div className="w-full max-w-4xl rounded-2xl border border-hairline bg-panel-raised p-6">
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
    <main className="min-h-screen bg-panel text-white">
      {/* The horizontal padding here is load-bearing: the sticky save bar cancels
          it with a matching negative margin. Change one, change the other. */}
      <div className="mx-auto max-w-4xl px-5 pt-8 sm:px-8 sm:pt-12">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex-1 min-w-0">
            <h1 className="text-3xl font-bold tracking-tight text-accent-soft sm:text-4xl">PFE Admin</h1>
            <p className="mt-1.5 text-sm text-gray-400 max-w-[48ch]">
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
            <Link href="/verify" className={chip}>
              Verify
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
          className={`mt-8 flex flex-col gap-5 rounded-2xl border p-5 sm:mt-10 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:p-6 ${open
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
              : 'bg-accent-deep text-white hover:bg-accent-deep/90 hover:shadow-lg hover:shadow-accent/25'
              }`}
          >
            {toggling
              ? 'Saving…'
              : draft.registrationOpen
                ? 'Close registration'
                : 'Open registration'}
          </button>
        </section>

        <SyncStaleBanner lastSuccessAt={syncStatus.lastSuccessAt} loaded={syncStatus.loaded} />

        {/* Scrolls sideways inside itself on a narrow screen rather than wrapping
            into three ragged rows. The page itself never scrolls horizontally. */}
        <div className="-mx-5 mt-8 overflow-x-auto px-5 [scrollbar-width:none] sm:-mx-8 sm:mt-10 sm:px-8 [&::-webkit-scrollbar]:hidden">
          <nav className="flex w-max gap-1 rounded-xl border border-hairline bg-panel-raised p-1.5">
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

        {/* Same raised surface as AdminGate's card. Opaque, not the /30 used on
            the marketing pages: this one carries dense grey-on-dark form text. */}
        <div className="mt-4 rounded-2xl border border-hairline bg-panel-raised p-5 sm:p-7">
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
                These are the amounts students are charged. The server computes every order from
                them; the browser never sends a price. Changes take effect on the next checkout.
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
              <p className="mt-6 border-t border-hairline pt-5 text-xs leading-relaxed text-gray-400">
                ACM member pricing is delivered as coupons, not a separate price list. Generate the
                member codes on the Coupons tab.
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
              <p className="mt-6 border-t border-hairline pt-5 text-xs leading-relaxed text-gray-400">
                The confirmation email reads these values too, so a date changed here is a date
                changed on every ticket sent from now on. Tickets already sent keep the old text.
              </p>
            </section>
          )}

          {tab === 'fields' && (
            <section>
              <Lead>
                What registrants read. The data keys beside each row are the database columns and
                never change, so renaming a label is safe — but the Google Sheet, /stats and the
                registration list still use the column names, and will keep saying &ldquo;course&rdquo;
                and &ldquo;department&rdquo;.
              </Lead>

              <div className="mb-9 space-y-3">
                {FIELD_ROWS.map(({ key, control, hint }) => (
                  <WordingRow
                    key={key}
                    fieldKey={key}
                    control={control}
                    hint={hint}
                    value={draft.fieldLabels[key]}
                    onChange={(p) => patchLabel(key, p)}
                  />
                ))}
              </div>

              <Lead>Dropdown contents. One option per line. Order is preserved.</Lead>
              <Field
                text={`${draft.fieldLabels.college.label} options`}
                hint="Keep an 'Other' entry — it drives the free-text fallback."
              >
                <ListEditor
                  value={draft.fieldOptions.colleges}
                  onChange={(v) => patchFields({ colleges: v })}
                />
              </Field>
              <Field text={`${draft.fieldLabels.course.label} options`} hint="Column: course">
                <ListEditor
                  value={draft.fieldOptions.courses}
                  onChange={(v) => patchFields({ courses: v })}
                />
              </Field>
              <Field text={`${draft.fieldLabels.department.label} options`} hint="Column: department">
                <ListEditor
                  value={draft.fieldOptions.departments}
                  onChange={(v) => patchFields({ departments: v })}
                />
              </Field>
              <Field text={`${draft.fieldLabels.year.label} options`}>
                <ListEditor value={draft.fieldOptions.years} onChange={(v) => patchFields({ years: v })} />
              </Field>
            </section>
          )}

          {tab === 'tracks' && <TracksTab editor={tracksEditor} />}

          {tab === 'coupons' && <CouponsTab editor={couponsEditor} />}
        </div>

        {/* Appears only when there is something to do or report.

            It used to be permanent: a full-bleed slab holding one greyed-out
            button in a field of empty space, on every tab, whether or not
            anything had changed. A disabled control is not information. Now the
            page simply ends when the page has ended, and the bar arrives —
            floating, card-width, aligned to the content above rather than
            bleeding past it — the moment it has a job. */}
        {showBar && (
          <div className="sticky bottom-4 z-10 mt-8 mb-8 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-xl border border-hairline bg-panel-raised/95 px-4 py-3 shadow-lg shadow-black/40 backdrop-blur">
            <div className="flex items-center gap-1">
              {!onCoupons && barDirty && (
                <>
                  <button
                    onClick={barSave}
                    disabled={barStatus.kind === 'saving'}
                    className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-accent-deep px-5 font-semibold text-white transition-[background-color,box-shadow,transform,opacity] duration-200 ease-out hover:bg-accent-deep/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-soft active:scale-[0.99] disabled:opacity-60 disabled:active:scale-100"
                  >
                    {barStatus.kind === 'saving' ? 'Saving…' : onTracks ? 'Save tracks' : 'Save changes'}
                  </button>
                  <button
                    onClick={barDiscard}
                    className="inline-flex min-h-[44px] items-center justify-center rounded-lg px-3.5 text-sm text-gray-400 transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-soft"
                  >
                    Discard
                  </button>
                </>
              )}
              {!onCoupons && !barDirty && barStatus.kind === 'ok' && (
                <span className="inline-flex items-center gap-2 px-1 text-sm font-medium text-emerald-300">
                  <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Saved
                </span>
              )}
              {!onCoupons && barStatus.kind === 'error' && (
                <span className="px-1 text-sm text-red-300">{barStatus.message}</span>
              )}
            </div>

            {/* Work pending on a tab you are not looking at. On Coupons BOTH other
                editors can be dirty at once, so name whichever actually are —
                "the Tracks tab" while prices are also unsaved would be a lie. */}
            {pendingElsewhere.length > 0 && (
              <span className="text-xs leading-snug text-amber-300/90">
                Unsaved changes on {pendingElsewhere.join(' and ')}
                {onCoupons ? '.' : ', which this does not save.'}
              </span>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

export default function AdminPage() {
  return <AdminGate title="PFE Admin">{({ creds, logout }) => <Panel creds={creds} logout={logout} />}</AdminGate>;
}
