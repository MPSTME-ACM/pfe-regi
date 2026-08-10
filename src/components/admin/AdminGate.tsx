'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';

/**
 * Basic-auth gate shared by every admin screen.
 *
 * This login form was previously copy-pasted into /sync, /stats and /verify,
 * three times with three sets of small differences. Anything new should use
 * this; the remaining copies should migrate to it.
 *
 * The credential is a `Basic <base64>` string kept in sessionStorage and
 * replayed on each request — that is how the existing admin routes authenticate.
 * Replacing this with real sessions is tracked separately; do not build more on
 * top of it than the panel needs.
 */

const STORAGE_KEY = 'admin-creds';

export type AdminRole = 'admin' | 'member';

/** Read the stored credential outside a React tree (e.g. in an event handler). */
export function getStoredCreds(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(STORAGE_KEY);
}

export function clearStoredCreds() {
  sessionStorage.removeItem(STORAGE_KEY);
}

function LoginForm({
  title,
  role,
  onLogin,
  error,
  setError,
}: {
  title: string;
  role: AdminRole;
  onLogin: (user: string, pass: string) => void;
  error: string;
  setError: (err: string) => void;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setError('Username and password are required.');
      return;
    }
    setError('');
    setBusy(true);
    await onLogin(username, password);
    setBusy(false);
  };

  const [showPassword, setShowPassword] = useState(false);
  const [capsOn, setCapsOn] = useState(false);

  const field =
    'w-full bg-white/[0.04] border border-white/15 rounded-lg px-3.5 py-3 text-white ' +
    'placeholder-gray-600 outline-none transition-[border-color,background-color,box-shadow] duration-200 ' +
    'hover:border-white/25 focus:border-accent/60 focus:bg-white/[0.07] focus:ring-2 focus:ring-accent/25';

  return (
    <div className="w-full max-w-[22rem]">
      {/* Wordmark outside the card: it identifies the system, it is not a field. */}
      <div className="mb-7 text-center">
        <Image
          src="/pfelogo.png"
          alt="Programming for Everyone"
          width={1235}
          height={727}
          className="mx-auto w-40 h-auto"
          priority
        />
        <p className="mt-3 text-[13px] tracking-wide text-gray-500">
          {role === 'admin' ? 'Organiser access' : 'ACM member access'}
        </p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-black/40 backdrop-blur-md p-6 sm:p-7 shadow-2xl shadow-black/40">
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        <p className="mt-1 mb-6 text-sm text-gray-400">
          {role === 'admin'
            ? 'Sign in to manage registration, pricing and tracks.'
            : 'Sign in to register ACM members.'}
        </p>

        <form onSubmit={handleSubmit} noValidate>
          <label htmlFor="ag-user" className="block text-xs font-medium uppercase tracking-wider text-gray-400 mb-1.5">
            Username
          </label>
          <input
            id="ag-user"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            aria-invalid={!!error}
            className={field}
          />

          <label
            htmlFor="ag-pass"
            className="mt-5 block text-xs font-medium uppercase tracking-wider text-gray-400 mb-1.5"
          >
            Password
          </label>
          <div className="relative">
            <input
              id="ag-pass"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              // Caps Lock is the single most common cause of a "wrong password"
              // that is not actually wrong. Read from the event rather than
              // tracking keydown state.
              onKeyUp={(e) => setCapsOn(e.getModifierState?.('CapsLock') ?? false)}
              onBlur={() => setCapsOn(false)}
              autoComplete="current-password"
              aria-invalid={!!error}
              className={`${field} pr-16`}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-pressed={showPassword}
              className="absolute inset-y-0 right-0 px-3.5 text-xs font-medium text-gray-400 hover:text-white focus-visible:outline-2 focus-visible:outline-accent-soft focus-visible:outline-offset-[-4px] rounded-r-lg transition-colors"
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>

          {capsOn && (
            <p className="mt-2 text-xs text-amber-300/90">Caps Lock is on.</p>
          )}

          {error && (
            <p
              role="alert"
              className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mt-6 w-full rounded-lg bg-accent py-3 font-semibold text-black transition-[transform,box-shadow,opacity] duration-200 ease-out hover:shadow-lg hover:shadow-accent/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:scale-[0.99] disabled:opacity-50 disabled:active:scale-100"
          >
            {busy ? 'Checking…' : 'Sign in'}
          </button>
        </form>
      </div>

      <p className="mt-5 text-center text-xs text-gray-600">
        Committee use only. Every change here is live immediately.
      </p>
    </div>
  );
}

export default function AdminGate({
  title = 'Admin Verification',
  role = 'admin',
  children,
}: {
  title?: string;
  role?: AdminRole;
  /** Rendered once authenticated. Receives the credential to replay on fetches. */
  children: (ctx: { creds: string; logout: () => void }) => React.ReactNode;
}) {
  const [creds, setCreds] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setCreds(getStoredCreds());
    setReady(true);
  }, []);

  const handleLogin = async (user: string, pass: string) => {
    const next = `Basic ${btoa(`${user}:${pass}`)}`;
    const endpoint = role === 'admin' ? '/api/login' : '/api/member-login';
    try {
      const res = await fetch(endpoint, { headers: { Authorization: next } });
      if (!res.ok) {
        setError('Invalid username or password');
        return;
      }
      setError('');
      sessionStorage.setItem(STORAGE_KEY, next);
      setCreds(next);
    } catch {
      setError('Network error during authentication');
    }
  };

  const logout = () => {
    clearStoredCreds();
    setCreds(null);
    setError('');
  };

  // Avoid flashing the login form for an already-authenticated admin while
  // sessionStorage is being read on mount.
  if (!ready) {
    return <main className="min-h-screen" />;
  }

  if (!creds) {
    // No opaque background here. `layout.tsx` renders the animated <Background />
    // behind everything, and the old `bg-gray-900` painted straight over it —
    // so the sign-in screen was the one surface in the product that did not look
    // like the product.
    return (
      <main className="min-h-screen text-white flex items-center justify-center px-4 py-10">
        <LoginForm
          title={title}
          role={role}
          onLogin={handleLogin}
          error={error}
          setError={setError}
        />
      </main>
    );
  }

  return <>{children({ creds, logout })}</>;
}
