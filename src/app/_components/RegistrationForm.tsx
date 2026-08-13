"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import PolicyLinks from './PolicyLinks';
import ProgramHeader from './ProgramHeader';
import { InputField, SelectField, type SelectOption } from './FormFields';
import SkuChooser, { SKUS } from './SkuChooser';
import TrackFields, { type TrackFieldName } from './TrackFields';
import { type TrackOption } from './registrationTypes';
import type { EventConfig, FieldOptions, FieldLabels } from '@/lib/db/schema';
import CouponField, { formatPaiseClient, type AppliedCoupon } from './CouponField';
import type { Sku } from '@/lib/pricing/resolvePrice';
// A bare constant module — safe to import here because it reaches nothing.
import { OTHER_COLLEGE } from '@/lib/registration/college';

// ─────────────────────────────────────────────────────────────────────────────
// The public registration form, 2026 model.
//
// 2025 posted a flat `formData` blob with a single `domain` field. That shape is
// now rejected outright by api/create-order, so the body is built explicitly
// from the chosen SKU instead of being stringified wholesale. That is not
// tidiness — `resolveSelection` rejects a capstone order that carries any track
// slug, and a single-track order that carries two. Both of those are what a
// stringified blob produces the moment someone picks bundle, fills the selects,
// then switches to capstone.
//
// Nothing here may import a runtime value from `@/lib/settings` or
// `@/lib/registration/capacity`: both reach `@/lib/db` and would pull drizzle and
// node-postgres into the browser bundle. Type-only imports are fine (they erase).
// ─────────────────────────────────────────────────────────────────────────────

interface CheckoutResult {
  error?: { message: string; code: string };
  redirect?: boolean;
  paymentDetails?: { paymentMessage: string };
}

interface CheckoutOptions {
  paymentSessionId: string;
  redirectTarget: string;
}

interface CashfreeSDK {
  checkout(options: CheckoutOptions): Promise<CheckoutResult>;
}

/** The draft that is mirrored into sessionStorage. */
interface Draft {
  name: string;
  email: string;
  contact: string;
  college: string;
  /** Only used when `college` is 'Other'. Blank otherwise. */
  collegeOther: string;
  course: string;
  department: string;
  year: string;
  referral: string;
  sku: Sku | '';
  /** Slug chosen for the `single` SKU — routed to the right key at submit time. */
  singleTrack: string;
  beginnerTrack: string;
  advancedTrack: string;
}

const EMPTY_DRAFT: Draft = {
  name: '', email: '', contact: '', college: '', collegeOther: '', course: '', department: '', year: '',
  referral: '', sku: '', singleTrack: '', beginnerTrack: '', advancedTrack: '',
};

const DRAFT_KEY = 'pfe-form-data';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTACT_RE = /^[6-9]\d{9}$/;

/** Everything except `referral`, which is optional and must not count towards
 *  the completion ring. Track fields are added per SKU by `requiredFor`. */
const BASE_REQUIRED = [
  'name', 'email', 'contact', 'college', 'course', 'department', 'year', 'sku',
] as const satisfies readonly (keyof Draft)[];

function requiredFor(sku: Sku | '', college: string): (keyof Draft)[] {
  // `collegeOther` is required only on the branch that renders it. Counting it
  // unconditionally would leave the completion ring permanently one short for
  // every NMIMS registrant, who never sees the field.
  const base: (keyof Draft)[] =
    college === OTHER_COLLEGE ? [...BASE_REQUIRED, 'collegeOther'] : [...BASE_REQUIRED];
  if (sku === 'single') return [...base, 'singleTrack'];
  if (sku === 'bundle') return [...base, 'beginnerTrack', 'advancedTrack'];
  return base;
}

/**
 * Rebuild a draft from whatever sessionStorage happens to hold.
 *
 * Whitelisted key by key rather than spread: a 2025 draft carries `domain`, and
 * a stale one carries a track that has since filled up. Restoring either would
 * hand the server a payload it rejects, which is exactly the failure this stream
 * exists to remove. A slug that is unknown or full comes back empty so the user
 * re-picks from a list where it is visibly disabled.
 */
function restoreDraft(raw: string, tracks: TrackOption[]): Draft | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Record<string, unknown>;

  const str = (key: string) => (typeof record[key] === 'string' ? (record[key] as string) : '');
  const slug = (key: string) => {
    const value = str(key);
    const track = tracks.find((t) => t.slug === value);
    return track && !track.full ? value : '';
  };

  return {
    name: str('name'),
    email: str('email'),
    contact: str('contact'),
    college: str('college'),
    collegeOther: str('collegeOther'),
    course: str('course'),
    department: str('department'),
    year: str('year'),
    referral: str('referral'),
    sku: SKUS.includes(record.sku as Sku) ? (record.sku as Sku) : '',
    singleTrack: slug('singleTrack'),
    beginnerTrack: slug('beginnerTrack'),
    advancedTrack: slug('advancedTrack'),
  };
}

const toOptions = (values: string[]): SelectOption[] =>
  values.map((value) => ({ value, label: value }));

export default function RegistrationForm({
  eventConfig,
  fieldOptions,
  fieldLabels,
  referredBy,
  tracks: initialTracks,
  priceLabels,
  cashfreeMode,
  merchantName,
  merchantEmail,
}: {
  eventConfig: EventConfig;
  fieldOptions: FieldOptions;
  /** Labels and placeholders, editable at /admin. Keys are the column names. */
  fieldLabels: FieldLabels;
  /** Referrer name from the /r/<CODE> cookie. Display only — checkout reads the
   *  cookie itself, so nothing here can change who gets credited. */
  referredBy: string | null;
  /** Server-rendered availability, so the selects are correct on first paint. */
  tracks: TrackOption[];
  /** Display only. The server computes and stores the real amount. */
  priceLabels: Record<Sku, string>;
  /** Driven by CASHFREE_ENV on the server. Was hardcoded to "production", which
   *  made it impossible to test a real checkout against the sandbox. */
  cashfreeMode: 'sandbox' | 'production';
  merchantName: string;
  merchantEmail: string;
}) {
  const [formData, setFormData] = useState<Draft>(EMPTY_DRAFT);
  // Kept out of `Draft` on purpose: the draft is persisted to localStorage, and
  // a discount restored from a previous session could be stale or since revoked.
  // A code is cheap to retype and must be re-checked against the server anyway.
  const [couponInput, setCouponInput] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<AppliedCoupon | null>(null);
  const [tracks, setTracks] = useState<TrackOption[]>(initialTracks);
  const router = useRouter();
  const [progress, setProgress] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [cashfree, setCashfree] = useState<CashfreeSDK | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [paymentSessionId, setPaymentSessionId] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState({ email: '', contact: '' });
  const [submitError, setSubmitError] = useState('');

  const isOtherCollege = formData.college === OTHER_COLLEGE;

  // ── draft restore / persist ────────────────────────────────────────────────
  // Restored against the server-rendered track list, which is why this runs once
  // on mount rather than waiting for the availability refresh below.
  useEffect(() => {
    const saved = sessionStorage.getItem(DRAFT_KEY);
    if (!saved) return;
    const draft = restoreDraft(saved, initialTracks);
    if (draft) setFormData(draft);
    // initialTracks is a server prop and stable for the life of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(formData));
  }, [formData]);

  useEffect(() => {
    const initializeSDK = async () => {
      const { load } = await import('@cashfreepayments/cashfree-js');
      setCashfree(await load({ mode: cashfreeMode }));
    };
    initializeSDK();
  }, [cashfreeMode]);

  // ── progress ring ──────────────────────────────────────────────────────────
  // The denominator moves with the SKU: a capstone buyer has no track to pick,
  // so a full capstone form must still read 100%.
  const required = useMemo(
    () => requiredFor(formData.sku, formData.college),
    [formData.sku, formData.college],
  );

  useEffect(() => {
    const filled = required.filter((key) => formData[key] !== '').length;
    setProgress((filled / required.length) * 100);
  }, [formData, required]);

  // ── live availability ──────────────────────────────────────────────────────
  const refreshAvailability = useCallback(async () => {
    try {
      const response = await fetch('/api/domain-count');
      const data = await response.json();
      // On any failure keep the server-rendered list rather than blanking the
      // selects — a stale-but-present list beats an empty one.
      if (data.success && Array.isArray(data.tracks)) setTracks(data.tracks as TrackOption[]);
    } catch (error) {
      console.error('Failed to fetch track availability:', error);
    }
  }, []);

  useEffect(() => {
    refreshAvailability();
  }, [refreshAvailability]);

  // A track that filled up while this tab was open is dropped from the selection
  // so it cannot be submitted. Returning `prev` unchanged when nothing is stale
  // keeps this from looping.
  useEffect(() => {
    setFormData((prev) => {
      const ok = (slug: string) => {
        if (!slug) return true;
        const track = tracks.find((t) => t.slug === slug);
        return Boolean(track && !track.full);
      };
      if (ok(prev.singleTrack) && ok(prev.beginnerTrack) && ok(prev.advancedTrack)) return prev;
      return {
        ...prev,
        singleTrack: ok(prev.singleTrack) ? prev.singleTrack : '',
        beginnerTrack: ok(prev.beginnerTrack) ? prev.beginnerTrack : '',
        advancedTrack: ok(prev.advancedTrack) ? prev.advancedTrack : '',
      };
    });
  }, [tracks]);

  // ── change handlers ────────────────────────────────────────────────────────
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => {
      // Course and Department swap between <select> and free text with the
      // college. Carrying the old value across would leave the ring counting a
      // field the new control cannot display, and post a course that is not on
      // the list.
      if (name === 'college' && value !== prev.college) {
        // collegeOther cleared too: leaving a stale "VJTI Mumbai" behind after a
        // switch back to NMIMS would post a contradiction the form cannot show.
        return { ...prev, college: value, collegeOther: '', course: '', department: '' };
      }
      return { ...prev, [name]: value };
    });
    if (name === 'email' || name === 'contact') {
      setFormErrors((prev) => ({ ...prev, [name]: '' }));
    }
  };

  // A quote is only true for the selection it was priced against. Changing the
  // SKU or a track invalidates it, and a discount left on screen after the
  // change would be a price we do not intend to honour — checkout reprices from
  // `settings` regardless. Dropping it is the only safe move; re-applying is one
  // click, and a wrong price is not.
  const handleSkuChange = (sku: Sku) => {
    setSubmitError('');
    setAppliedCoupon(null);
    setFormData((prev) => ({ ...prev, sku }));
  };

  const handleTrackChange = (name: TrackFieldName, value: string) => {
    setSubmitError('');
    setAppliedCoupon(null);
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  /**
   * The body /api/quote needs, or null when the selection cannot be priced yet.
   *
   * Deliberately derived from `buildPayload()` rather than assembled by hand, so
   * the quote and the checkout can never disagree about which track slug goes in
   * which key — the routing rule that "a single beginner track is sent as
   * beginnerTrack" lives in exactly one place.
   */
  const buildQuoteBody = (): Record<string, string> | null => {
    const payload = buildPayload();
    if (typeof payload === 'string') return null;
    const { sku, beginnerTrack, advancedTrack, email, contact } = payload;
    return {
      sku,
      ...(beginnerTrack ? { beginnerTrack } : {}),
      ...(advancedTrack ? { advancedTrack } : {}),
      // Sent so a per-person redemption cap is evaluated against the right
      // person. Blank while the fields are empty, which reads as "nobody" and
      // simply quotes the optimistic case; checkout enforces it either way.
      email,
      contact,
    };
  };

  // ── submit ─────────────────────────────────────────────────────────────────
  /**
   * The request body, built from the SKU rather than from the whole draft.
   * Returns a message instead of a body when the selection is incomplete, so the
   * user gets told here rather than by a 400.
   */
  const buildPayload = (): Record<string, string> | string => {
    if (!formData.sku) return 'Choose what you want to register for.';

    const payload: Record<string, string> = {
      name: formData.name.trim(),
      email: formData.email.trim(),
      contact: formData.contact.trim(),
      college: formData.college.trim(),
      course: formData.course.trim(),
      department: formData.department.trim(),
      year: formData.year.trim(),
      sku: formData.sku,
    };
    // Sent only on the branch that collects it. On any other college the field
    // was never rendered, so an empty string here would be noise the server has
    // to strip anyway.
    if (formData.college === OTHER_COLLEGE && formData.collegeOther.trim()) {
      payload.collegeOther = formData.collegeOther.trim();
    }
    if (formData.referral.trim()) payload.referral = formData.referral.trim();
    // Only a code the server has already accepted is sent. An unchecked string
    // would make create-order 400 and block checkout outright; handleSubmit
    // stops that earlier with a message telling them to press Apply.
    if (appliedCoupon) payload.couponCode = appliedCoupon.code;

    if (formData.sku === 'single') {
      const track = tracks.find((t) => t.slug === formData.singleTrack);
      if (!track) return 'Choose a track.';
      if (track.full) return `${track.name} is full. Please choose another track.`;
      // The server takes the slug in the key matching its segment; sending both
      // is rejected as "a single track means one track, not two".
      if (track.segment === 'beginner') payload.beginnerTrack = track.slug;
      else payload.advancedTrack = track.slug;
    }

    if (formData.sku === 'bundle') {
      const beginner = tracks.find((t) => t.slug === formData.beginnerTrack);
      const advanced = tracks.find((t) => t.slug === formData.advancedTrack);
      if (!beginner || !advanced) return 'A bundle needs one beginner and one advanced track.';
      if (beginner.full || advanced.full) {
        return `${(beginner.full ? beginner : advanced).name} is full. Please choose another track.`;
      }
      payload.beginnerTrack = beginner.slug;
      payload.advancedTrack = advanced.slug;
    }

    return payload;
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitError('');

    const errors = { email: '', contact: '' };
    if (!EMAIL_RE.test(formData.email)) {
      errors.email = 'Please enter a valid email address.';
    }
    if (!CONTACT_RE.test(formData.contact)) {
      errors.contact = 'Please enter a valid 10-digit mobile number.';
    }
    setFormErrors(errors);
    if (errors.email || errors.contact) return;

    // A typed-but-unapplied code is the quiet failure worth blocking: sending it
    // makes create-order reject the whole checkout, and dropping it charges full
    // price to someone who believes they have a discount. Neither is acceptable,
    // so ask.
    if (couponInput.trim() && !appliedCoupon) {
      setSubmitError('Press Apply to check your coupon code, or clear the box to continue without one.');
      return;
    }

    const payload = buildPayload();
    if (typeof payload === 'string') {
      setSubmitError(payload);
      return;
    }

    // A fully-discounted order never reaches the gateway — completeWithoutPayment
    // issues the ticket server-side — so a slow or blocked Cashfree SDK must not
    // stop it. Only gate on the SDK when there is actually money to take.
    if (!cashfree && appliedCoupon?.amount !== 0) {
      setSubmitError('Payment system is still loading. Please try again in a moment.');
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch('/api/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();

      if (data.success && data.payment_session_id) {
        setPaymentSessionId(data.payment_session_id);
        setOrderId(data.order_id);
        sessionStorage.removeItem(DRAFT_KEY);
      } else if (data.success && data.free) {
        // A zero-value order never reaches Cashfree — the server completed it
        // already. Without this branch a successful registration would show
        // "Failed to create order".
        sessionStorage.removeItem(DRAFT_KEY);
        router.push(`/payment-status?order_id=${data.order_id}`);
        return;
      } else if (data.error === 'REGISTRATION_CLOSED') {
        // The admin closed registration while this tab was open.
        setSubmitError('Registration has just closed. Please refresh the page.');
      } else if (data.error === 'COUPON_REJECTED' || data.error === 'COUPON_INVALID') {
        // The quote said yes and checkout said no — the code was exhausted or
        // revoked in between, since checkout re-reads usage with the coupon row
        // locked. Drop it so the price on screen stops claiming a discount that
        // will not be honoured, and let them try another.
        setAppliedCoupon(null);
        setSubmitError(data.message || 'That code can no longer be used. Please remove it and try again.');
      } else if (data.error === 'TRACK_FULL') {
        // The message names the track by display name only; do not try to work
        // out which slug it was. Re-reading availability disables it properly.
        setSubmitError(data.message || 'That track just filled up. Please choose another.');
        refreshAvailability();
      } else {
        setSubmitError(data.message || 'Failed to create order. Please try again.');
      }
    } catch (error) {
      console.error('An error occurred:', error);
      setSubmitError('Network error. Please check your connection and try again.');
    }
    setIsLoading(false);
  };

  useEffect(() => {
    if (!paymentSessionId || !cashfree) return;
    cashfree
      .checkout({ paymentSessionId, redirectTarget: '_modal' })
      .then((result: CheckoutResult) => {
        if (result.paymentDetails || result.error) {
          if (orderId) {
            router.push(`/payment-status?order_id=${orderId}`);
          } else {
            console.error('Order ID not available for redirect.');
            setIsLoading(false);
          }
        }
      });
    setIsLoading(false);
  }, [paymentSessionId, cashfree, orderId, router]);

  const headPosition = progress;
  const bodyPosition = Math.max(0, progress - 1);

  return (
    <>
      <style jsx global>{`
        .progress-glow-container { position: relative; padding: 2px; }
        .progress-glow-container::before {
          content: '';
          position: absolute; top: 0; left: 0; right: 0; bottom: 0;
          border-radius: 18px; padding: 2px;
          background: conic-gradient(from 0deg at 50% 50%, #e97bfc 0%, #e97bfc ${bodyPosition}%, #f8c8fc ${headPosition}%, transparent ${headPosition}%, transparent 100%);
          -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          -webkit-mask-composite: xor;
          mask-composite: exclude;
          z-index: -1;
          transition: background 0.8s cubic-bezier(0.25, 1, 0.5, 1);
        }
      `}</style>
      {/* overflow-x-clip, not hidden: it keeps the merchant-email tooltip from
          ever pushing the page sideways on a narrow viewport, while leaving
          vertical overflow visible. */}
      <main className="flex min-h-screen items-center justify-center overflow-x-clip p-4 font-sans text-white sm:p-6 md:p-8">
        <div className="w-full max-w-3xl bg-black/30 backdrop-blur-md rounded-2xl border border-white/10 progress-glow-container">
          <div className="p-8 sm:p-10 md:p-12">
            <ProgramHeader dateRange={eventConfig.dateRange} />

            {!paymentSessionId ? (
              <form onSubmit={handleSubmit}>
                <SkuChooser value={formData.sku} priceLabels={priceLabels} onChange={handleSkuChange} />

                <TrackFields
                  sku={formData.sku}
                  tracks={tracks}
                  singleTrack={formData.singleTrack}
                  beginnerTrack={formData.beginnerTrack}
                  advancedTrack={formData.advancedTrack}
                  onChange={handleTrackChange}
                />

                <InputField label={fieldLabels.name.label} type="text" placeholder={fieldLabels.name.placeholder} name="name" value={formData.name} onChange={handleInputChange} required />
                <InputField label={fieldLabels.email.label} type="email" placeholder={fieldLabels.email.placeholder} name="email" value={formData.email} onChange={handleInputChange} required error={formErrors.email} />
                <InputField label={fieldLabels.contact.label} type="tel" placeholder={fieldLabels.contact.placeholder} name="contact" value={formData.contact} onChange={handleInputChange} required error={formErrors.contact} />

                <SelectField label={fieldLabels.college.label} placeholder={fieldLabels.college.placeholder} name="college" options={toOptions(fieldOptions.colleges)} value={formData.college} onChange={handleInputChange} required />

                {/* Outside NMIMS the course and department lists do not apply, so
                    they become free text rather than forcing a wrong pick. */}
                {isOtherCollege ? (
                  <>
                    {/* Asked first: without it the college is recorded as the
                        literal word "Other" and the actual name is lost, which
                        is why no report could ever break down non-NMIMS signups. */}
                    <InputField label={fieldLabels.collegeOther.label} type="text" placeholder={fieldLabels.collegeOther.placeholder} name="collegeOther" value={formData.collegeOther} onChange={handleInputChange} required />
                    <InputField label={fieldLabels.course.label} type="text" placeholder={fieldLabels.course.placeholder} name="course" value={formData.course} onChange={handleInputChange} required />
                    <InputField label={fieldLabels.department.label} type="text" placeholder={fieldLabels.department.placeholder} name="department" value={formData.department} onChange={handleInputChange} required />
                  </>
                ) : (
                  <>
                    <SelectField label={fieldLabels.course.label} placeholder={fieldLabels.course.selectPrompt} name="course" options={toOptions(fieldOptions.courses)} value={formData.course} onChange={handleInputChange} required />
                    <SelectField label={fieldLabels.department.label} placeholder={fieldLabels.department.selectPrompt} name="department" options={toOptions(fieldOptions.departments)} value={formData.department} onChange={handleInputChange} required />
                  </>
                )}

                <SelectField label={fieldLabels.year.label} placeholder={fieldLabels.year.placeholder} name="year" options={toOptions(fieldOptions.years)} value={formData.year} onChange={handleInputChange} required />
                {/* Arrived through a referrer's link. Shown, not editable: the
                    cookie is what checkout reads, so an input here could only
                    ever disagree with the thing that actually decides credit.
                    The typed field below still appears, for anyone holding a
                    code without a link — and a typed code wins over the cookie. */}
                {referredBy && (
                  <div className="mb-6 rounded-lg border border-hairline bg-white/[0.04] px-4 py-3">
                    <p className="text-sm text-gray-300">
                      Referred by <span className="font-medium text-accent-soft">{referredBy}</span>
                    </p>
                  </div>
                )}

                <InputField label={fieldLabels.referral.label} type="text" name="referral" placeholder={fieldLabels.referral.placeholder} value={formData.referral} onChange={handleInputChange} />

                {/* Below Referral because the two are different things and get
                    confused: a referral attributes the signup to a committee
                    member and changes no price, a coupon changes the price. */}
                <CouponField
                  value={couponInput}
                  onChange={setCouponInput}
                  applied={appliedCoupon}
                  onApplied={setAppliedCoupon}
                  onCleared={() => setAppliedCoupon(null)}
                  buildQuoteBody={buildQuoteBody}
                />

                <div className="mt-12 text-center">
                  {/* Display only. Whatever this says is cosmetic — api/create-order
                      recomputes the amount from `settings` and never reads one
                      off the request. */}
                  <p className="text-2xl font-bold text-white" aria-live="polite">
                    {!formData.sku ? (
                      <span className="text-lg font-semibold text-gray-400">Choose an option above to see the price</span>
                    ) : appliedCoupon ? (
                      <>
                        Ticket Price:{' '}
                        {/* The struck-through original stays visible: a discount
                            you cannot see the size of is not reassuring. */}
                        <span className="font-medium text-gray-500 line-through decoration-gray-500">
                          {formatPaiseClient(appliedCoupon.base)}
                        </span>{' '}
                        <span className="text-accent-soft">{formatPaiseClient(appliedCoupon.amount)}</span>
                      </>
                    ) : (
                      <>Ticket Price: {priceLabels[formData.sku]}</>
                    )}
                  </p>
                  {appliedCoupon?.amount === 0 && (
                    <p className="mt-2 text-sm font-medium text-accent-soft">
                      This code covers the full amount — you will not be asked to pay.
                    </p>
                  )}
                  {/* Held to a short measure so it stays 2-3 balanced lines
                      instead of one 95-character line on desktop and a ragged
                      block on mobile. */}
                  <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-balance text-gray-500">
                    You will be securely redirected to our payment partner to complete your payment to{' '}
                    <Link href={`mailto:${merchantEmail}`} className="group relative inline-block rounded-sm font-medium text-gray-400 transition-colors hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-soft">
                      {merchantName}
                      {/* max-w keeps a long merchant email from pushing the
                          page sideways on a narrow viewport. */}
                      <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-max max-w-[min(16rem,calc(100vw-3rem))] -translate-x-1/2 rounded-md bg-black px-2 py-1 text-xs break-words text-white opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                        {merchantEmail}
                      </span>
                    </Link>.
                  </p>
                  {submitError && <p className="mx-auto mt-4 max-w-md text-sm text-balance text-red-400" role="alert">{submitError}</p>}
                  <button
                    type="submit"
                    disabled={isLoading}
                    className="mx-auto mt-6 w-full max-w-xs transform rounded-lg bg-accent px-6 py-3 text-lg font-bold text-white transition-all duration-300 ease-in-out hover:scale-105 hover:shadow-2xl hover:shadow-accent/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isLoading ? 'Processing...' : 'Proceed to Pay'}
                  </button>
                </div>
              </form>
            ) : (
              <div id="cf_checkout" className="w-full" />
            )}

            <PolicyLinks note="By registering, you agree to our policies." />
          </div>
        </div>
      </main>
    </>
  );
}
