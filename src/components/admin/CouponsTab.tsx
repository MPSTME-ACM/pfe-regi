'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clearStoredCreds } from '@/components/admin/AdminGate';
import type { CouponType, Sku } from '@/lib/pricing/resolvePrice';

// ─────────────────────────────────────────────────────────────────────────────
// The Coupons tab.
//
// Three things live here:
//   1. a summary of what discounting has actually cost,
//   2. create-one / generate-many, which is how ACM's member codes get made,
//   3. referrers — create, deactivate, and copy each one's /r/<CODE> link.
//
// (3) was read-only until the link work, on the reasoning that a referrer code
// carries no discount so there was nothing to get wrong at 2am. That hid a real
// bug: nothing could write to `referrers`, so every code typed into the form's
// Referral box matched no row and credited nobody. Production had zero rows.
//
// ── Why this editor has no save/discard/dirty ────────────────────────────────
//
// Every other tab in the panel edits a draft and commits it through the sticky
// save bar in app/admin/page.tsx. This one deliberately does not, and the
// omission is load-bearing: that bar is tab-scoped (`tab === 'tracks'`), so a
// tab that exposes `dirty`/`save` gets folded into it, and anything that falls
// through the tracks branch inherits the SETTINGS save — the same shape of bug
// that once let an admin press Save on the Tracks tab, see a green "Saved", and
// leave registration open while the button read "Open registration".
//
// So `useCouponsEditor` returns no `dirty`, no `save` and no `discard`. There is
// nothing for the bar to bind to. Every write here applies immediately, on its
// own request, and reports its own result — like the open/close toggle above the
// tabs, and for the same reason. Do not add a draft to this file.
//
// ── The PATCH hazard ─────────────────────────────────────────────────────────
//
// api/admin/coupons PATCH has two shapes. `{ id, enabled }` and *nothing else*
// is a safe partial toggle; the server checks `Object.keys(body).length === 2`.
// ANY other PATCH runs the body through parseRules() and writes the FULL rule
// set, so a well-meaning `{ id, note }` silently resets maxUses, maxPerPerson,
// validFrom and validUntil to null — unlimited, forever — and enabled to true.
// On a batch of single-use ACM codes that turns 200 half-price seats into 200
// infinitely-reusable ones.
//
// This file therefore ships NO general edit form. The only PATCH it can emit is
// built from an inline object literal in `setEnabled` with exactly two keys. A
// coupon's rules are fixed at creation; to change them, disable the code and
// make a new one. There is also no DELETE on the route, so disable is the whole
// retirement story.
// ─────────────────────────────────────────────────────────────────────────────

/** A row from GET /api/admin/coupons. Timestamps arrive as ISO strings. */
export interface AdminCoupon {
  id: number;
  code: string;
  type: CouponType;
  value: number;
  appliesTo: string[];
  minAmount: number | null;
  maxUses: number | null;
  maxPerPerson: number | null;
  validFrom: string | null;
  validUntil: string | null;
  enabled: boolean;
  batchId: string | null;
  note: string | null;
  createdAt: string;
  /**
   * Redemptions that still count against `maxUses`: burned, PLUS reserved ones
   * that have not expired. It can therefore go *down* between reloads when an
   * abandoned checkout's hold lapses. Shown as "used", never as "sold".
   */
  used: number;
}

export interface CouponSummary {
  /** Paise discounted across every redemption row, reserved ones included. */
  totalDiscountedPaise: number;
  /** Redemptions settled by a successful payment. */
  burned: number;
}

export interface ReferrerStat {
  id: number;
  code: string;
  name: string;
  active: boolean;
  /**
   * Every registration carrying this code — including `pending` and `failure`.
   * NOT the same population as `paise`, which counts success/comped only.
   */
  registrations: number;
  paise: number;
}

/** The writable rule set, already in wire units (paise, ISO strings). */
export interface CouponRules {
  type: CouponType;
  value: number;
  appliesTo: Sku[];
  minAmount: number | null;
  maxUses: number | null;
  maxPerPerson: number | null;
  validFrom: string | null;
  validUntil: string | null;
  enabled: boolean;
  note: string | null;
}

export type CreateResult =
  | { ok: true; coupon: AdminCoupon }
  | { ok: false; message: string };

export type GenerateResult =
  | { ok: true; batchId: string; codes: string[]; requested: number }
  | { ok: false; message: string };

type Status = { kind: 'idle' | 'loading' | 'saving' | 'ok' | 'error'; message?: string };

export interface CouponsEditor {
  coupons: AdminCoupon[] | null;
  summary: CouponSummary | null;
  referrers: ReferrerStat[];
  status: Status;
  /** Ids with an enable/disable request in flight. */
  pending: ReadonlySet<number>;
  reload: () => Promise<void>;
  create: (code: string, rules: CouponRules) => Promise<CreateResult>;
  generate: (count: number, prefix: string, rules: CouponRules) => Promise<GenerateResult>;
  setEnabled: (id: number, enabled: boolean) => Promise<void>;
  createReferrer: (code: string, name: string) => Promise<{ ok: boolean; message: string }>;
  setReferrerActive: (id: number, active: boolean) => Promise<void>;
  // No `dirty`, no `save`, no `discard`. See the header — this is on purpose.
}

// Server-side caps, mirrored so the form refuses input the route would 400.
const MAX_VALUE_PAISE = 10_000_00;
const MAX_USES = 100_000;
const MAX_PER_PERSON = 1000;
const MAX_BATCH = 500;
const MAX_PREFIX = 12;

const SKUS: Sku[] = ['capstone', 'single', 'bundle'];

/**
 * Coupon list state. Loads the first time the tab is opened rather than on
 * mount, matching useTracksEditor: a DB hiccup in here must not put an error
 * banner in front of an admin who only came to flip registration open.
 */
export function useCouponsEditor(creds: string, active: boolean): CouponsEditor {
  const [coupons, setCoupons] = useState<AdminCoupon[] | null>(null);
  const [summary, setSummary] = useState<CouponSummary | null>(null);
  const [referrers, setReferrers] = useState<ReferrerStat[]>([]);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [pending, setPending] = useState<ReadonlySet<number>>(() => new Set());
  const [requested, setRequested] = useState(false);

  /** A 401 means the shared password changed under us. Bounce to the login. */
  const expired = useCallback((res: Response) => {
    if (res.status !== 401) return false;
    clearStoredCreds();
    window.location.reload();
    return true;
  }, []);

  const reload = useCallback(async () => {
    setStatus({ kind: 'loading' });
    try {
      const res = await fetch('/api/admin/coupons', { headers: { Authorization: creds } });
      if (expired(res)) return;
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || 'Failed to load coupons');
      setCoupons(data.coupons);
      setSummary(data.summary);
      setReferrers(data.referrers ?? []);
      setStatus({ kind: 'idle' });
    } catch (e) {
      setStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, [creds, expired]);

  useEffect(() => {
    if (!active || requested) return;
    setRequested(true);
    reload();
  }, [active, requested, reload]);

  const create = useCallback(
    async (code: string, rules: CouponRules): Promise<CreateResult> => {
      setStatus({ kind: 'saving' });
      try {
        const res = await fetch('/api/admin/coupons', {
          method: 'POST',
          headers: { Authorization: creds, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...rules, code }),
        });
        if (expired(res)) return { ok: false, message: 'Session expired' };
        const data = await res.json();
        // 409 carries the colliding code in its message; show it verbatim.
        if (!res.ok || !data.success) throw new Error(data.message || 'Could not create the code');
        setCoupons((rows) => (rows ? [data.coupon, ...rows] : [data.coupon]));
        setStatus({ kind: 'ok', message: `Created ${data.coupon.code}` });
        return { ok: true, coupon: data.coupon };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setStatus({ kind: 'error', message });
        return { ok: false, message };
      }
    },
    [creds, expired],
  );

  const generate = useCallback(
    async (count: number, prefix: string, rules: CouponRules): Promise<GenerateResult> => {
      setStatus({ kind: 'saving' });
      try {
        const res = await fetch('/api/admin/coupons', {
          method: 'POST',
          headers: { Authorization: creds, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...rules, generate: count, prefix }),
        });
        if (expired(res)) return { ok: false, message: 'Session expired' };
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.message || 'Could not generate codes');
        // The bulk response carries codes, not rows. Re-read to get the rows.
        await reload();
        setStatus({ kind: 'ok', message: `Generated ${data.codes.length} codes` });
        return {
          ok: true,
          batchId: data.batchId,
          codes: data.codes,
          requested: typeof data.requested === 'number' ? data.requested : data.codes.length,
        };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setStatus({ kind: 'error', message });
        return { ok: false, message };
      }
    },
    [creds, expired, reload],
  );

  /**
   * The ONLY PATCH this file emits.
   *
   * The body is an inline literal with exactly two keys, never a spread and
   * never an options object, because the server's partial-update guard is
   * `Object.keys(body).length === 2`. One extra field and this silently becomes
   * a full rule-set write that nulls every limit on the coupon.
   */
  const setEnabled = useCallback(
    async (id: number, enabled: boolean) => {
      setPending((s) => new Set(s).add(id));
      try {
        const res = await fetch('/api/admin/coupons', {
          method: 'PATCH',
          headers: { Authorization: creds, 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, enabled }),
        });
        if (expired(res)) return;
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.message || 'Could not update the code');
        // The PATCH response is the raw row and has no `used` — keep ours, or
        // the usage column renders "undefined / ∞".
        setCoupons((rows) =>
          rows?.map((c) => (c.id === id ? { ...c, ...data.coupon, used: c.used } : c)) ?? rows,
        );
        setStatus({ kind: 'ok', message: `${data.coupon.code} ${enabled ? 'enabled' : 'disabled'}` });
      } catch (e) {
        setStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
      } finally {
        setPending((s) => {
          const next = new Set(s);
          next.delete(id);
          return next;
        });
      }
    },
    [creds, expired],
  );

  // Referrer writes go straight to the server on their own request, like every
  // other control on this tab. They must never be routed through the admin
  // page's sticky save bar: that bar is gated `tab !== 'coupons'`, so a change
  // parked in it from here would be silently dropped while reporting "Saved".
  const createReferrer = useCallback(
    async (code: string, name: string) => {
      try {
        const res = await fetch('/api/admin/referrers', {
          method: 'POST',
          headers: { Authorization: creds, 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, name }),
        });
        if (expired(res)) return { ok: false, message: 'Session expired' };
        const data = await res.json();
        if (!res.ok || !data.success) {
          return { ok: false, message: data.message || 'Could not create that referrer' };
        }
        // Reload rather than splice: the leaderboard row carries aggregate
        // counts this response does not have, and a hand-built row would show
        // "undefined sign-ups" until the next refresh.
        await reload();
        return { ok: true, message: `${data.referrer.code} created` };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    },
    [creds, expired, reload],
  );

  const setReferrerActive = useCallback(
    async (id: number, active: boolean) => {
      try {
        const res = await fetch('/api/admin/referrers', {
          method: 'PATCH',
          headers: { Authorization: creds, 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, active }),
        });
        if (expired(res)) return;
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.message || 'Could not update the referrer');
        setReferrers((rows) => rows.map((r) => (r.id === id ? { ...r, active } : r)));
        setStatus({ kind: 'ok', message: `${data.referrer.code} ${active ? 'activated' : 'deactivated'}` });
      } catch (e) {
        setStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    },
    [creds, expired],
  );

  return {
    coupons, summary, referrers, status, pending, reload, create, generate, setEnabled,
    createReferrer, setReferrerActive,
  };
}

// ─── formatting ──────────────────────────────────────────────────────────────

// Local, two lines, on purpose. `formatPaise` in @/lib/settings would do this
// but that module imports the database, and this is a client component.
const rupees = (paise: number) =>
  `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const rupeesToPaise = (text: string) => Math.round(Number(text) * 100);

/** What the code actually does to a price, in one phrase. */
function describe(c: Pick<AdminCoupon, 'type' | 'value'>) {
  switch (c.type) {
    case 'percent':
      return `${c.value}% off`;
    case 'flat':
      return `${rupees(c.value)} off`;
    case 'fixed':
      return `Price becomes ${rupees(c.value)}`;
    case 'free':
      return 'Free — order becomes ₹0';
  }
}

/** `12 / ∞` rather than `12 / null`. Null max means unlimited. */
const usage = (c: AdminCoupon) => `${c.used} / ${c.maxUses ?? '∞'}`;

/** An empty appliesTo means every SKU. */
const scope = (appliesTo: string[]) =>
  appliesTo.length === 0 ? 'All products' : appliesTo.join(', ');

/**
 * A returned ISO instant, in the admin's own timezone.
 *
 * Never `.toISOString().slice(0, 16)` — that renders UTC, and a code the
 * committee set to expire at 11pm IST would read as 17:30 the same day.
 */
const showWhen = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : null;

/** Why a code would be refused right now, or null if it is live. */
function inactiveReason(c: AdminCoupon, now: number): string | null {
  if (!c.enabled) return 'Disabled';
  if (c.maxUses !== null && c.used >= c.maxUses) return 'Used up';
  if (c.validUntil && new Date(c.validUntil).getTime() < now) return 'Expired';
  if (c.validFrom && new Date(c.validFrom).getTime() > now) return 'Not started';
  return null;
}

// ─── shared classes ──────────────────────────────────────────────────────────

// `bg-white/5` fill rather than the opaque panel colour: globals.css overrides
// Chrome's autofill paint with a single literal matched to exactly that value.
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

// ─── export helpers ──────────────────────────────────────────────────────────

const CSV_COLUMNS = [
  'code',
  'discount',
  'appliesTo',
  'used',
  'maxUses',
  'maxPerPerson',
  'validFrom',
  'validUntil',
  'enabled',
  'note',
] as const;

const csvCell = (v: string | number | boolean | null) =>
  `"${String(v ?? '').replace(/"/g, '""')}"`;

function toCsv(rows: AdminCoupon[]) {
  const body = rows.map((c) =>
    [
      c.code,
      describe(c),
      scope(c.appliesTo),
      c.used,
      c.maxUses ?? '',
      c.maxPerPerson ?? '',
      c.validFrom ?? '',
      c.validUntil ?? '',
      c.enabled,
      c.note ?? '',
    ]
      .map(csvCell)
      .join(','),
  );
  // BOM so Excel opens it as UTF-8 — notes are free text and can be anything.
  return `﻿${CSV_COLUMNS.join(',')}\n${body.join('\n')}\n`;
}

function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Copy-to-clipboard with a transient confirmation.
 *
 * Handing codes to ACM is the actual job of this screen, so the button has to
 * say whether it worked. `navigator.clipboard` rejects on an insecure origin,
 * which is exactly the case (a laptop on the venue LAN) where silence is worst.
 */
function useCopier() {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = useCallback(async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
    } catch {
      setCopied(`${key}:failed`);
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), 2500);
  }, []);

  return { copied, copy };
}

// ─── the create / generate form ──────────────────────────────────────────────

type Mode = 'single' | 'batch';

interface FormState {
  mode: Mode;
  code: string;
  prefix: string;
  count: string;
  type: CouponType;
  value: string;
  appliesTo: Sku[];
  minAmount: string;
  maxUses: string;
  maxPerPerson: string;
  validFrom: string;
  validUntil: string;
  note: string;
  enabled: boolean;
}

const EMPTY_FORM: FormState = {
  mode: 'single',
  code: '',
  prefix: '',
  count: '50',
  type: 'percent',
  value: '10',
  appliesTo: [],
  minAmount: '',
  maxUses: '',
  maxPerPerson: '',
  validFrom: '',
  validUntil: '',
  note: '',
  enabled: true,
};

/**
 * The ACM member batch, one click.
 *
 * These codes are not a separate mechanism — they are ordinary coupons with
 * type=percent, value=50, maxUses=1 — and that is easy to get wrong by hand
 * (leave maxUses blank and one code covers the whole society). So it is a
 * preset, not an instruction in a doc.
 */
const ACM_PRESET: Partial<FormState> = {
  mode: 'batch',
  prefix: 'ACM',
  count: '50',
  type: 'percent',
  value: '50',
  appliesTo: [],
  maxUses: '1',
  maxPerPerson: '1',
  note: 'ACM member 50% off',
};

const optionalPaise = (text: string) => (text.trim() === '' ? null : rupeesToPaise(text));
const optionalCount = (text: string) => (text.trim() === '' ? null : Math.round(Number(text)));

/** datetime-local is offset-less; pin the instant before it crosses the wire. */
const toIso = (local: string) => {
  if (!local.trim()) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

function validate(f: FormState): string[] {
  const errors: string[] = [];

  if (f.mode === 'single') {
    if (!f.code.trim()) errors.push('A code is required.');
    if (f.code.trim().length > 40) errors.push('A code can be at most 40 characters.');
  } else {
    const n = Number(f.count);
    if (!Number.isInteger(n) || n < 1 || n > MAX_BATCH) {
      errors.push(`How many must be a whole number from 1 to ${MAX_BATCH}.`);
    }
    if (f.prefix.trim().length > MAX_PREFIX) {
      errors.push(`A prefix can be at most ${MAX_PREFIX} characters.`);
    }
  }

  if (f.type === 'percent') {
    const v = Number(f.value);
    if (!Number.isInteger(v) || v < 1 || v > 100) errors.push('A percentage must be a whole number from 1 to 100.');
  } else if (f.type === 'flat' || f.type === 'fixed') {
    const paise = rupeesToPaise(f.value);
    if (!Number.isFinite(paise) || paise < 0 || paise > MAX_VALUE_PAISE) {
      errors.push(`The amount must be between ₹0 and ${rupees(MAX_VALUE_PAISE)}.`);
    }
  }

  const min = optionalPaise(f.minAmount);
  if (min !== null && (!Number.isFinite(min) || min < 0 || min > MAX_VALUE_PAISE)) {
    errors.push(`Minimum order must be between ₹0 and ${rupees(MAX_VALUE_PAISE)}.`);
  }
  const uses = optionalCount(f.maxUses);
  if (uses !== null && (!Number.isInteger(uses) || uses < 0 || uses > MAX_USES)) {
    errors.push(`Total uses must be a whole number up to ${MAX_USES.toLocaleString('en-IN')}, or blank for unlimited.`);
  }
  const per = optionalCount(f.maxPerPerson);
  if (per !== null && (!Number.isInteger(per) || per < 0 || per > MAX_PER_PERSON)) {
    errors.push(`Uses per person must be a whole number up to ${MAX_PER_PERSON}, or blank for unlimited.`);
  }

  const from = toIso(f.validFrom);
  const until = toIso(f.validUntil);
  if (f.validFrom.trim() && !from) errors.push('Valid from is not a real date.');
  if (f.validUntil.trim() && !until) errors.push('Valid until is not a real date.');
  if (from && until && from > until) errors.push('Valid from is after valid until, so the code could never be used.');

  return errors;
}

function toRules(f: FormState): CouponRules {
  const value =
    f.type === 'percent'
      ? Math.round(Number(f.value))
      : f.type === 'free'
        ? 0
        : rupeesToPaise(f.value);

  return {
    type: f.type,
    value,
    appliesTo: f.appliesTo,
    minAmount: optionalPaise(f.minAmount),
    maxUses: optionalCount(f.maxUses),
    maxPerPerson: optionalCount(f.maxPerPerson),
    validFrom: toIso(f.validFrom),
    validUntil: toIso(f.validUntil),
    enabled: f.enabled,
    note: f.note.trim() || null,
  };
}

function CreatePanel({ editor }: { editor: CouponsEditor }) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<GenerateResult | null>(null);
  const { copied, copy } = useCopier();

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const toggleSku = (sku: Sku) =>
    setForm((f) => ({
      ...f,
      appliesTo: f.appliesTo.includes(sku)
        ? f.appliesTo.filter((s) => s !== sku)
        : [...f.appliesTo, sku],
    }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const found = validate(form);
    setErrors(found);
    if (found.length) return;

    setBusy(true);
    setMade(null);
    const rules = toRules(form);
    if (form.mode === 'batch') {
      const res = await editor.generate(Math.round(Number(form.count)), form.prefix.trim(), rules);
      // The form is deliberately NOT reset after a batch: the usual next action
      // is "same rules, fifty more", and the codes panel below carries the result.
      if (res.ok) setMade(res);
      else setErrors([res.message]);
    } else {
      const res = await editor.create(form.code.trim(), rules);
      if (res.ok) setForm((f) => ({ ...EMPTY_FORM, mode: f.mode, type: f.type, value: f.value }));
      else setErrors([res.message]);
    }
    setBusy(false);
  };

  const batch = form.mode === 'batch';
  const shortfall = made?.ok ? made.requested - made.codes.length : 0;

  return (
    <section className="rounded-2xl border border-hairline bg-white/[0.02] p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-accent-soft">
          Make codes
        </h3>
        <button
          type="button"
          onClick={() => {
            setForm((f) => ({ ...f, ...ACM_PRESET }));
            setErrors([]);
            setMade(null);
          }}
          className={ghostButton}
        >
          ACM 50% preset
        </button>
      </div>
      <p className="mt-2 max-w-[64ch] text-xs leading-relaxed text-gray-400">
        ACM member pricing is not a separate price list — it is a batch of ordinary coupons at 50%
        with one use each. The preset fills that in; press it, set how many, generate.
      </p>

      {/* Mode switch. A batch and a named code differ in one field, so they share
          one form rather than being two screens the committee has to choose between. */}
      <div
        role="group"
        aria-label="What to make"
        className="mt-4 inline-flex rounded-xl border border-hairline bg-panel p-1"
      >
        {(['single', 'batch'] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => set('mode', m)}
            aria-pressed={form.mode === m}
            className={`min-h-[44px] rounded-lg px-4 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-soft ${
              form.mode === m
                ? 'bg-accent/15 font-semibold text-accent-soft ring-1 ring-inset ring-accent/30'
                : 'text-gray-400 hover:bg-white/[0.06] hover:text-white'
            }`}
          >
            {m === 'single' ? 'One named code' : 'Generate a batch'}
          </button>
        ))}
      </div>

      <form onSubmit={submit} noValidate className="mt-5">
        <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
          {batch ? (
            <>
              <div>
                <label htmlFor="cp-prefix" className={smallLabel}>
                  Prefix
                </label>
                <input
                  id="cp-prefix"
                  className={`${input} font-mono uppercase`}
                  value={form.prefix}
                  maxLength={MAX_PREFIX}
                  placeholder="ACM"
                  onChange={(e) => set('prefix', e.target.value.toUpperCase())}
                />
                <p className="mt-1.5 text-xs text-gray-500">
                  Each code is the prefix plus five unambiguous characters.
                </p>
              </div>
              <div>
                <label htmlFor="cp-count" className={smallLabel}>
                  How many
                </label>
                <input
                  id="cp-count"
                  type="number"
                  min={1}
                  max={MAX_BATCH}
                  step={1}
                  className={`${input} tabular-nums`}
                  value={form.count}
                  onChange={(e) => set('count', e.target.value)}
                />
                <p className="mt-1.5 text-xs text-gray-500">Up to {MAX_BATCH} at a time.</p>
              </div>
            </>
          ) : (
            <div className="sm:col-span-2">
              <label htmlFor="cp-code" className={smallLabel}>
                Code
              </label>
              <input
                id="cp-code"
                className={`${input} font-mono uppercase`}
                value={form.code}
                maxLength={40}
                placeholder="EARLYBIRD"
                onChange={(e) => set('code', e.target.value.toUpperCase())}
              />
              <p className="mt-1.5 text-xs text-gray-500">
                Stored uppercase and trimmed. Students type this by hand.
              </p>
            </div>
          )}

          <div>
            <label htmlFor="cp-type" className={smallLabel}>
              Discount type
            </label>
            <select
              id="cp-type"
              className={input}
              value={form.type}
              onChange={(e) => set('type', e.target.value as CouponType)}
            >
              <option value="percent">Percent off</option>
              <option value="flat">Fixed amount off</option>
              <option value="fixed">Set the price</option>
              <option value="free">Free</option>
            </select>
          </div>

          <div>
            <label htmlFor="cp-value" className={smallLabel}>
              {form.type === 'percent'
                ? 'Percent off'
                : form.type === 'flat'
                  ? 'Amount off (₹)'
                  : form.type === 'fixed'
                    ? 'Resulting price (₹)'
                    : 'Value'}
            </label>
            <input
              id="cp-value"
              type="number"
              min={0}
              max={form.type === 'percent' ? 100 : MAX_VALUE_PAISE / 100}
              step={1}
              disabled={form.type === 'free'}
              className={`${input} tabular-nums disabled:cursor-not-allowed disabled:opacity-40`}
              value={form.type === 'free' ? '' : form.value}
              placeholder={form.type === 'free' ? 'Not used' : undefined}
              onChange={(e) => set('value', e.target.value)}
            />
            <p className="mt-1.5 text-xs text-gray-500">
              {form.type === 'percent'
                ? '1 to 100.'
                : form.type === 'flat'
                  ? 'Subtracted from the order total.'
                  : form.type === 'fixed'
                    ? 'Replaces the price outright, whatever the product costs.'
                    : 'A free code ignores this — the order becomes ₹0.'}
            </p>
          </div>

          <fieldset className="sm:col-span-2">
            <legend className={smallLabel}>Applies to</legend>
            <div className="flex flex-wrap gap-2">
              {SKUS.map((sku) => {
                const on = form.appliesTo.includes(sku);
                return (
                  <button
                    key={sku}
                    type="button"
                    onClick={() => toggleSku(sku)}
                    aria-pressed={on}
                    className={`min-h-[44px] rounded-lg border px-4 text-sm capitalize transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-soft ${
                      on
                        ? 'border-accent/40 bg-accent/15 font-semibold text-accent-soft'
                        : 'border-hairline bg-white/[0.04] text-gray-400 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    {sku}
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-xs text-gray-500">
              {form.appliesTo.length === 0
                ? 'Nothing selected means the code works on every product.'
                : `Only on ${form.appliesTo.join(', ')}.`}
            </p>
          </fieldset>

          <div>
            <label htmlFor="cp-min" className={smallLabel}>
              Minimum order (₹)
            </label>
            <input
              id="cp-min"
              type="number"
              min={0}
              step={1}
              className={`${input} tabular-nums`}
              value={form.minAmount}
              placeholder="No minimum"
              onChange={(e) => set('minAmount', e.target.value)}
            />
          </div>

          <div>
            <label htmlFor="cp-uses" className={smallLabel}>
              Total uses
            </label>
            <input
              id="cp-uses"
              type="number"
              min={0}
              max={MAX_USES}
              step={1}
              className={`${input} tabular-nums`}
              value={form.maxUses}
              placeholder="Unlimited"
              onChange={(e) => set('maxUses', e.target.value)}
            />
            <p className="mt-1.5 text-xs text-gray-500">Blank is unlimited. A member code is 1.</p>
          </div>

          <div>
            <label htmlFor="cp-per" className={smallLabel}>
              Uses per person
            </label>
            <input
              id="cp-per"
              type="number"
              min={0}
              max={MAX_PER_PERSON}
              step={1}
              className={`${input} tabular-nums`}
              value={form.maxPerPerson}
              placeholder="Unlimited"
              onChange={(e) => set('maxPerPerson', e.target.value)}
            />
          </div>

          <div>
            <label htmlFor="cp-from" className={smallLabel}>
              Valid from
            </label>
            <input
              id="cp-from"
              type="datetime-local"
              className={input}
              value={form.validFrom}
              onChange={(e) => set('validFrom', e.target.value)}
            />
          </div>

          <div>
            <label htmlFor="cp-until" className={smallLabel}>
              Valid until
            </label>
            <input
              id="cp-until"
              type="datetime-local"
              className={input}
              value={form.validUntil}
              onChange={(e) => set('validUntil', e.target.value)}
            />
            <p className="mt-1.5 text-xs text-gray-500">
              Both are in your own timezone. Blank means no limit.
            </p>
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="cp-note" className={smallLabel}>
              Note
            </label>
            <input
              id="cp-note"
              className={input}
              value={form.note}
              maxLength={500}
              placeholder="What this is for, who it went to"
              onChange={(e) => set('note', e.target.value)}
            />
          </div>
        </div>

        {/* Rules cannot be edited afterwards — there is no edit form and no
            delete — so the summary sits directly above the button that commits it. */}
        <p className="mt-5 rounded-lg border border-hairline bg-panel px-3.5 py-3 text-sm text-gray-300">
          <span className="text-gray-500">This makes: </span>
          {describe({ type: form.type, value: form.type === 'percent' ? Math.round(Number(form.value) || 0) : rupeesToPaise(form.value) || 0 })}
          {' · '}
          {scope(form.appliesTo)}
          {' · '}
          {form.maxUses.trim() === '' ? 'unlimited uses' : `${form.maxUses} use(s) total`}
          {form.validUntil.trim() ? ` · until ${showWhen(toIso(form.validUntil))}` : ''}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-gray-500">
          Rules are fixed once created — this panel has no edit form, because a partial edit on the
          API rewrites every limit at once. To change a code, disable it and make another.
        </p>

        {errors.length > 0 && (
          <ul role="alert" className="mt-4 space-y-1 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-3">
            {errors.map((msg) => (
              <li key={msg} className="text-sm text-red-300">
                {msg}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="submit" disabled={busy} className={primaryButton}>
            {busy ? 'Working…' : batch ? `Generate ${form.count || '0'} codes` : 'Create code'}
          </button>
          <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => set('enabled', e.target.checked)}
              className="h-4 w-4 accent-accent"
            />
            Enabled straight away
          </label>
        </div>
      </form>

      {/* Handing these to ACM is the job. Show them once, big, copyable. */}
      {made?.ok && (
        <div className="mt-6 rounded-xl border border-accent/30 bg-accent/[0.07] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold text-accent-soft">
              Batch <span className="font-mono">{made.batchId}</span> — {made.codes.length} code
              {made.codes.length === 1 ? '' : 's'}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={ghostButton}
                onClick={() => copy('made', made.codes.join('\n'))}
              >
                {copied === 'made' ? 'Copied' : copied === 'made:failed' ? 'Copy failed' : 'Copy codes'}
              </button>
            </div>
          </div>
          {shortfall > 0 && (
            <p className="mt-2 text-sm text-amber-300">
              Generated {made.codes.length} of {made.requested} — the rest collided with existing
              codes. Generate {shortfall} more if you need the full run.
            </p>
          )}
          <pre className="mt-3 max-h-60 overflow-auto rounded-lg border border-hairline bg-panel p-3 font-mono text-xs leading-relaxed text-gray-300">
            {made.codes.join('\n')}
          </pre>
        </div>
      )}
    </section>
  );
}

// ─── the list ────────────────────────────────────────────────────────────────

function CouponRow({
  coupon,
  busy,
  onToggle,
}: {
  coupon: AdminCoupon;
  busy: boolean;
  onToggle: () => void;
}) {
  const reason = inactiveReason(coupon, Date.now());
  const from = showWhen(coupon.validFrom);
  const until = showWhen(coupon.validUntil);

  return (
    <div className="flex flex-wrap items-start gap-x-4 gap-y-2 py-3.5">
      <div className="min-w-0 flex-1 basis-48">
        <p className="font-mono text-sm font-semibold break-all text-white">{coupon.code}</p>
        <p className="mt-0.5 text-xs text-gray-400">
          {describe(coupon)} · {scope(coupon.appliesTo)}
          {coupon.minAmount !== null && ` · min ${rupees(coupon.minAmount)}`}
          {coupon.maxPerPerson !== null && ` · ${coupon.maxPerPerson} per person`}
        </p>
        {(from || until) && (
          <p className="mt-0.5 text-xs text-gray-500">
            {from && `From ${from}`}
            {from && until && ' · '}
            {until && `Until ${until}`}
          </p>
        )}
        {coupon.note && <p className="mt-0.5 text-xs text-gray-500">{coupon.note}</p>}
      </div>

      <div className="shrink-0 text-right">
        <p className="text-sm tabular-nums text-gray-300" title="Includes uses held by a checkout in progress">
          {usage(coupon)}
        </p>
        <p className="text-[10px] uppercase tracking-wider text-gray-500">used</p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {reason && reason !== 'Disabled' && (
          <span className="rounded-md bg-amber-400/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300 ring-1 ring-inset ring-amber-400/40">
            {reason}
          </span>
        )}
        <button
          type="button"
          onClick={onToggle}
          disabled={busy}
          aria-label={`${coupon.enabled ? 'Disable' : 'Enable'} ${coupon.code}`}
          className={`min-h-[44px] shrink-0 rounded-lg px-3.5 text-xs font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-soft disabled:opacity-50 ${
            coupon.enabled
              ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-400/40 hover:bg-emerald-500/25'
              : 'bg-white/[0.04] text-gray-500 ring-1 ring-inset ring-hairline hover:bg-white/10 hover:text-gray-300'
          }`}
        >
          {busy ? '…' : coupon.enabled ? 'Enabled' : 'Disabled'}
        </button>
      </div>
    </div>
  );
}

interface Group {
  key: string;
  batchId: string | null;
  rows: AdminCoupon[];
}

/** Standalone codes first — they are the hand-made ones people go looking for. */
function groupByBatch(rows: AdminCoupon[]): Group[] {
  const standalone: AdminCoupon[] = [];
  const batches = new Map<string, AdminCoupon[]>();
  for (const c of rows) {
    if (c.batchId === null) standalone.push(c);
    else {
      const list = batches.get(c.batchId);
      if (list) list.push(c);
      else batches.set(c.batchId, [c]);
    }
  }
  const out: Group[] = [];
  if (standalone.length) out.push({ key: '__standalone', batchId: null, rows: standalone });
  // Insertion order follows GET's `createdAt desc`, so newest batch first.
  for (const [batchId, list] of batches) out.push({ key: batchId, batchId, rows: list });
  return out;
}

/** How many rows of one group are painted before "show more". */
const PAGE = 25;
/** How many search hits are painted at once. */
const SEARCH_LIMIT = 60;

function GroupBlock({
  group,
  editor,
  copier,
}: {
  group: Group;
  editor: CouponsEditor;
  copier: ReturnType<typeof useCopier>;
}) {
  // Collapsed by default: one generation can be 500 rows, and three ACM batches
  // put 1500 on a phone. Nothing expands until it is asked for.
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(PAGE);

  const { rows } = group;
  const live = rows.filter((c) => c.enabled).length;
  const used = rows.reduce((n, c) => n + c.used, 0);
  const label = group.batchId ?? 'Standalone codes';
  const first = rows[0];

  return (
    <div className="border-t border-hairline">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-[44px] w-full flex-wrap items-center gap-x-3 gap-y-1 py-3.5 text-left transition-colors hover:bg-white/[0.03] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent-soft"
      >
        <span
          aria-hidden
          className={`inline-block shrink-0 text-gray-500 transition-transform ${open ? 'rotate-90' : ''}`}
        >
          ▸
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-mono text-sm font-semibold text-white">{label}</span>
          <span className="mt-0.5 block text-xs text-gray-500">
            {rows.length} code{rows.length === 1 ? '' : 's'} · {live} enabled · {used} used
            {first && group.batchId ? ` · ${describe(first)}` : ''}
          </span>
        </span>
      </button>

      {open && (
        <div className="pb-4">
          <div className="mb-2 flex flex-wrap gap-2">
            <button
              type="button"
              className={ghostButton}
              onClick={() => copier.copy(group.key, rows.map((c) => c.code).join('\n'))}
            >
              {copier.copied === group.key
                ? 'Copied'
                : copier.copied === `${group.key}:failed`
                  ? 'Copy failed'
                  : `Copy ${rows.length} codes`}
            </button>
            <button
              type="button"
              className={ghostButton}
              onClick={() => download(`${group.batchId ?? 'standalone'}-codes.csv`, toCsv(rows))}
            >
              Download CSV
            </button>
          </div>

          <div className="divide-y divide-hairline/60">
            {rows.slice(0, shown).map((c) => (
              <CouponRow
                key={c.id}
                coupon={c}
                busy={editor.pending.has(c.id)}
                onToggle={() => editor.setEnabled(c.id, !c.enabled)}
              />
            ))}
          </div>

          {rows.length > shown && (
            <button
              type="button"
              onClick={() => setShown((n) => n + PAGE * 2)}
              className={`${ghostButton} mt-3 w-full`}
            >
              Show more — {rows.length - shown} left
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── the tab ─────────────────────────────────────────────────────────────────

function Stat({ value, label, hint }: { value: string; label: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-hairline bg-white/[0.02] p-4">
      <p className="text-2xl font-semibold tabular-nums leading-none text-white">{value}</p>
      <p className="mt-1.5 text-[11px] font-medium uppercase tracking-wider text-gray-400">{label}</p>
      {hint && <p className="mt-1 text-xs leading-snug text-gray-500">{hint}</p>}
    </div>
  );
}

export function CouponsTab({ editor }: { editor: CouponsEditor }) {
  // `referrers` is no longer read here — ReferrersPanel takes the editor and
  // reads it itself, so the list and its write buttons stay in one component.
  const { coupons, summary, status } = editor;
  const [query, setQuery] = useState('');
  const copier = useCopier();

  const groups = useMemo(() => groupByBatch(coupons ?? []), [coupons]);

  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !coupons) return null;
    return coupons.filter(
      (c) =>
        c.code.toLowerCase().includes(q) ||
        (c.note?.toLowerCase().includes(q) ?? false) ||
        (c.batchId?.toLowerCase().includes(q) ?? false),
    );
  }, [coupons, query]);

  if (!coupons) {
    return (
      <section className="text-sm">
        {status.kind === 'error' ? (
          <p className="text-red-300">{status.message}</p>
        ) : (
          <p className="text-gray-400">Loading coupons…</p>
        )}
      </section>
    );
  }

  const enabled = coupons.filter((c) => c.enabled).length;

  return (
    <section>
      <p className="max-w-[68ch] text-sm leading-relaxed text-gray-400">
        A coupon is the only thing that changes what someone pays. Codes cannot be deleted or edited
        once made — disable them instead, so the discount on an order that already went through
        stays explainable afterwards.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          value={rupees(summary?.totalDiscountedPaise ?? 0)}
          label="Discounted"
          hint="Across every redemption, holds included."
        />
        <Stat
          value={String(summary?.burned ?? 0)}
          label="Settled uses"
          hint="Redemptions confirmed by a payment."
        />
        <Stat value={String(coupons.length)} label="Codes" />
        <Stat value={String(enabled)} label="Enabled" />
      </div>

      <div className="mt-6">
        <CreatePanel editor={editor} />
      </div>

      <div className="mt-8 border-t border-hairline pt-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0 flex-1 basis-56">
            <label htmlFor="cp-search" className={smallLabel}>
              Find a code
            </label>
            <input
              id="cp-search"
              type="search"
              className={input}
              value={query}
              placeholder="Code, note or batch"
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <button
            type="button"
            className={ghostButton}
            onClick={() => editor.reload()}
            disabled={status.kind === 'loading'}
          >
            {status.kind === 'loading' ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {hits ? (
          <div className="mt-5">
            <p className="text-xs text-gray-500">
              {hits.length} match{hits.length === 1 ? '' : 'es'}
              {hits.length > SEARCH_LIMIT && ` — showing the first ${SEARCH_LIMIT}`}
            </p>
            <div className="mt-2 divide-y divide-hairline/60 border-t border-hairline">
              {hits.slice(0, SEARCH_LIMIT).map((c) => (
                <CouponRow
                  key={c.id}
                  coupon={c}
                  busy={editor.pending.has(c.id)}
                  onToggle={() => editor.setEnabled(c.id, !c.enabled)}
                />
              ))}
            </div>
            {hits.length === 0 && (
              <p className="mt-4 text-sm text-gray-500">Nothing matches “{query.trim()}”.</p>
            )}
          </div>
        ) : (
          <div className="mt-5">
            {groups.length === 0 ? (
              <p className="rounded-xl border border-dashed border-hairline px-6 py-10 text-center text-sm text-gray-500">
                No codes yet. Generate a batch above.
              </p>
            ) : (
              <>
                {groups.map((g) => (
                  <GroupBlock key={g.key} group={g} editor={editor} copier={copier} />
                ))}
                <div className="border-t border-hairline" />
              </>
            )}
          </div>
        )}

        {status.kind === 'error' && (
          <p role="alert" className="mt-4 text-sm text-red-300">
            {status.message}
          </p>
        )}
      </div>

      <ReferrersPanel editor={editor} />
    </section>
  );
}

// ─── referrers ───────────────────────────────────────────────────────────────

/**
 * Referrers, and the links that make them work.
 *
 * This panel used to be read-only, on the reasoning that a referrer code carries
 * no discount so there is nothing to get wrong at 2am. That was wrong in a way
 * the leaderboard hid: nothing could write to the `referrers` table, so every
 * code typed into the form's Referral box resolved to null and credited nobody.
 * Production had zero rows and zero attributed registrations.
 *
 * The link is the point. A code someone has to remember and retype is lost some
 * fraction of the time, silently — no one reports a signup credited to no one.
 * /r/<CODE> sets an httpOnly cookie that checkout reads server-side, so
 * attribution no longer depends on the buyer doing anything at all.
 */
function ReferrersPanel({ editor }: { editor: CouponsEditor }) {
  const { referrers, createReferrer, setReferrerActive } = editor;
  const { copied, copy } = useCopier();

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  // window, not SITE_URL: this is the origin the admin is actually looking at,
  // so the copied link is always the one that works from where they are.
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const linkFor = (c: string) => `${origin}/r/${c}`;

  const submit = async () => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed || !name.trim()) {
      setResult({ ok: false, message: 'Both a code and a name are needed.' });
      return;
    }
    setBusy(true);
    const r = await createReferrer(trimmed, name.trim());
    setBusy(false);
    setResult(r);
    if (r.ok) {
      setCode('');
      setName('');
    }
  };

  return (
    <div className="mt-8 border-t border-hairline pt-6">
      <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-accent-soft">
        Referrers
      </h3>
      <p className="mt-1.5 max-w-[68ch] text-xs leading-relaxed text-gray-500">
        Attribution only — a referral code never changes a price. Share the link: anyone who opens
        it is credited automatically for the next 30 days, even if they never touch the Referral
        box. Sign-ups counts every registration carrying the code, including abandoned and failed
        ones; paid counts only what settled, which is why a referrer can read as 10 sign-ups and ₹0.
      </p>

      <div className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
        <div>
          <label className={smallLabel} htmlFor="ref-code">Code</label>
          <input
            id="ref-code"
            className={`${input} font-mono`}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } }}
            placeholder="ACM-SNDT-CAMPUS"
            autoComplete="off"
          />
        </div>
        <div>
          <label className={smallLabel} htmlFor="ref-name">Who it credits</label>
          <input
            id="ref-name"
            className={input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } }}
            placeholder="ACM SNDT Campus"
            autoComplete="off"
          />
        </div>
        <button type="button" onClick={submit} disabled={busy} className={`${ghostButton} disabled:opacity-40`}>
          {busy ? 'Adding…' : 'Add referrer'}
        </button>
      </div>

      <div aria-live="polite">
        {result && (
          <p className={`mt-2 text-xs ${result.ok ? 'text-accent-soft' : 'text-red-300'}`}>
            {result.message}
          </p>
        )}
      </div>

      {referrers.length === 0 ? (
        <p className="mt-5 text-sm text-gray-500">
          No referrer codes yet. Add one above to get a shareable link.
        </p>
      ) : (
        <div className="mt-5 divide-y divide-hairline/60 border-t border-hairline">
          {referrers.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
              <div className="min-w-0 flex-1 basis-48">
                <p className="truncate text-sm font-medium text-white">{r.name}</p>
                <p className="truncate font-mono text-xs text-gray-500">{linkFor(r.code)}</p>
              </div>

              {!r.active && (
                <span className="rounded-md bg-white/[0.06] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gray-400 ring-1 ring-inset ring-hairline">
                  Inactive
                </span>
              )}

              <div className="shrink-0 text-right">
                <p className="text-sm tabular-nums text-white">{r.registrations}</p>
                <p className="text-[10px] uppercase tracking-wider text-gray-500">sign-ups</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm tabular-nums text-white">{rupees(r.paise)}</p>
                <p className="text-[10px] uppercase tracking-wider text-gray-500">paid</p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => copy(`ref:${r.id}`, linkFor(r.code))}
                  className={ghostButton}
                >
                  {copied === `ref:${r.id}` ? 'Copied' : copied === `ref:${r.id}:failed` ? 'Copy failed' : 'Copy link'}
                </button>
                <button
                  type="button"
                  onClick={() => setReferrerActive(r.id, !r.active)}
                  className={ghostButton}
                >
                  {r.active ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
