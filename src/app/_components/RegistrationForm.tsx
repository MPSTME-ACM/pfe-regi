"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import PolicyLinks from './PolicyLinks';
import ProgramHeader from './ProgramHeader';
import type { EventConfig, FieldOptions } from '@/lib/db/schema';

// ─────────────────────────────────────────────────────────────────────────────
// The public registration form. Lifted out of the old `page.save.tsx`, which was
// swapped in and out by renaming files; the page is now rendered or not by the
// `registrationOpen` setting instead.
//
// Phase 1 kept the 2025 field set intact so that flipping the switch reproduces
// exactly what the rename used to do. The domain list below is still hardcoded
// to match the validation in api/create-order — phase 2 replaces both with the
// `tracks` table (7 tracks, 3 SKUs).
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

interface InputFieldProps {
  label: string;
  type: string;
  placeholder: string;
  error?: string;
  name: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  required?: boolean;
}

const InputField: React.FC<InputFieldProps> = ({ label, type, placeholder, name, value, onChange, required = false, error }) => (
  <div className="mb-6">
    <label htmlFor={name} className="block text-sm font-medium text-gray-300 mb-2">
      {label} {required && <span className="text-[#e97bfc]">*</span>}
    </label>
    <input
      type={type}
      id={name}
      name={name}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      required={required}
      className="w-full bg-white/5 border border-white/20 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#f8c8fc] transition-all duration-300 autofill:!bg-white/5"
    />
    {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
  </div>
);

interface SelectFieldProps {
  label: string;
  name: string;
  options: string[];
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  required?: boolean;
  domainStatus?: Record<string, boolean>;
}

const SelectField: React.FC<SelectFieldProps> = ({ label, name, options, value, onChange, required = false, domainStatus }) => (
  <div className="mb-6">
    <label htmlFor={name} className="block text-sm font-medium text-gray-300 mb-2">
      {label} {required && <span className="text-[#e97bfc]">*</span>}
    </label>
    <select
      id={name}
      name={name}
      value={value}
      onChange={onChange}
      required={required}
      className="w-full bg-white/5 border border-white/20 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-[#f8c8fc] appearance-none"
      style={{
        backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%23f8c8fc' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
        backgroundPosition: 'right 0.5rem center',
        backgroundRepeat: 'no-repeat',
        backgroundSize: '1.5em 1.5em',
        paddingRight: '2.5rem',
      }}
    >
      <option value="" disabled>Select your option</option>
      {options.map((option) => {
        const isAllowed = name === 'domain' && domainStatus ? domainStatus[option] ?? true : true;
        return (
          <option
            key={option}
            value={option}
            disabled={!isAllowed}
            className="bg-[#1a0d1f] text-white disabled:text-gray-500"
          >
            {option}{!isAllowed ? ' (Full)' : ''}
          </option>
        );
      })}
    </select>
  </div>
);

// Everything except `referral`, which is optional and must not count towards the
// completion ring. Module scope so the effect below has an honest dep array.
const REQUIRED_FIELDS = ['name', 'email', 'contact', 'course', 'department', 'year', 'domain'] as const;

export default function RegistrationForm({
  eventConfig,
  fieldOptions,
  priceLabel,
  cashfreeMode,
  merchantName,
  merchantEmail,
}: {
  eventConfig: EventConfig;
  fieldOptions: FieldOptions;
  priceLabel: string;
  /** Driven by CASHFREE_ENV on the server. Was hardcoded to "production", which
   *  made it impossible to test a real checkout against the sandbox. */
  cashfreeMode: 'sandbox' | 'production';
  merchantName: string;
  merchantEmail: string;
}) {
  const [formData, setFormData] = useState({
    name: '', email: '', contact: '', course: '', department: '', year: '', domain: '', referral: '',
  });
  const router = useRouter();
  const [progress, setProgress] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [cashfree, setCashfree] = useState<CashfreeSDK | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [paymentSessionId, setPaymentSessionId] = useState<string | null>(null);
  const [domainStatus, setDomainStatus] = useState<Record<string, boolean>>({});
  const [formErrors, setFormErrors] = useState({ email: '', contact: '' });
  const [submitError, setSubmitError] = useState('');

  // Must stay in sync with the allowedDomains check in api/create-order.
  const domains = ['C', 'Python', 'Web', 'DSA', 'AIML'];

  useEffect(() => {
    const saved = sessionStorage.getItem('pfe-form-data');
    if (!saved) return;
    try {
      setFormData(JSON.parse(saved));
    } catch (error) {
      console.error('Failed to parse saved form data:', error);
    }
  }, []);

  useEffect(() => {
    sessionStorage.setItem('pfe-form-data', JSON.stringify(formData));
  }, [formData]);

  useEffect(() => {
    const initializeSDK = async () => {
      const { load } = await import('@cashfreepayments/cashfree-js');
      setCashfree(await load({ mode: cashfreeMode }));
    };
    initializeSDK();
  }, [cashfreeMode]);

  useEffect(() => {
    const filled = REQUIRED_FIELDS.filter((k) => formData[k] !== '').length;
    setProgress((filled / REQUIRED_FIELDS.length) * 100);
  }, [formData]);

  useEffect(() => {
    const fetchDomainStatus = async () => {
      try {
        const response = await fetch('/api/domain-count');
        const data = await response.json();
        if (data.success && data.registrationAllowed) {
          setDomainStatus(data.registrationAllowed as Record<string, boolean>);
        }
      } catch (error) {
        console.error('Failed to fetch domain status:', error);
      }
    };
    fetchDomainStatus();
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (name === 'email' || name === 'contact') {
      setFormErrors((prev) => ({ ...prev, [name]: '' }));
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitError('');

    const errors = { email: '', contact: '' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      errors.email = 'Please enter a valid email address.';
    }
    if (!/^[6-9]\d{9}$/.test(formData.contact)) {
      errors.contact = 'Please enter a valid 10-digit mobile number.';
    }
    setFormErrors(errors);
    if (errors.email || errors.contact) return;

    if (!cashfree) {
      setSubmitError('Payment system is still loading. Please try again in a moment.');
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch('/api/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      const data = await response.json();

      if (data.success && data.payment_session_id) {
        setPaymentSessionId(data.payment_session_id);
        setOrderId(data.order_id);
        sessionStorage.removeItem('pfe-form-data');
      } else if (data.error === 'REGISTRATION_CLOSED') {
        // The admin closed registration while this tab was open.
        setSubmitError('Registration has just closed. Please refresh the page.');
      } else if (data.error === 'DOMAIN_FULL') {
        setSubmitError(`${data.message} Please pick a different domain.`);
        setFormData((prev) => ({ ...prev, domain: '' }));
        setDomainStatus((prev) => ({ ...prev, [formData.domain]: false }));
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
                <InputField label="Your Name" type="text" placeholder="Enter your full name" name="name" value={formData.name} onChange={handleInputChange} required />
                <InputField label="Your Email" type="email" placeholder="youremail@domain.com" name="email" value={formData.email} onChange={handleInputChange} required error={formErrors.email} />
                <InputField label="Contact Number" type="tel" placeholder="9876543210" name="contact" value={formData.contact} onChange={handleInputChange} required error={formErrors.contact} />
                <SelectField label="Course" name="course" options={fieldOptions.courses} value={formData.course} onChange={handleInputChange} required />
                <SelectField label="Department" name="department" options={fieldOptions.departments} value={formData.department} onChange={handleInputChange} required />
                <SelectField label="Current Academic Year" name="year" options={fieldOptions.years} value={formData.year} onChange={handleInputChange} required />
                <SelectField label="Choose one domain to participate in" name="domain" options={domains} value={formData.domain} onChange={handleInputChange} required domainStatus={domainStatus} />
                <InputField label="Referral" type="text" name="referral" placeholder="Optional" value={formData.referral} onChange={handleInputChange} />

                <div className="mt-12 text-center">
                  <p className="text-2xl font-bold text-white">Ticket Price: {priceLabel}</p>
                  {/* Held to a short measure so it stays 2-3 balanced lines
                      instead of one 95-character line on desktop and a ragged
                      block on mobile. */}
                  <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-balance text-gray-500">
                    You will be securely redirected to our payment partner to complete your payment to{' '}
                    <Link href={`mailto:${merchantEmail}`} className="group relative inline-block rounded-sm font-medium text-gray-400 transition-colors hover:text-[#e97bfc] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f8c8fc]">
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
                    className="mx-auto mt-6 w-full max-w-xs transform rounded-lg bg-[#e97bfc] px-6 py-3 text-lg font-bold text-white transition-all duration-300 ease-in-out hover:scale-105 hover:shadow-2xl hover:shadow-[#e97bfc]/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
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
