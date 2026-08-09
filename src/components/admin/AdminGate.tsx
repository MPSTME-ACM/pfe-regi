'use client';

import { useEffect, useState } from 'react';

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
  onLogin,
  error,
  setError,
}: {
  title: string;
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

  return (
    <div className="w-full max-w-sm p-8 bg-black/30 backdrop-blur-md rounded-2xl border border-white/10 shadow-2xl shadow-[#e97bfc]/10">
      <h2 className="text-2xl font-bold text-center text-white mb-6">{title}</h2>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Username"
          autoComplete="username"
          className="w-full bg-white/5 border border-white/20 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#f8c8fc] transition-all"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoComplete="current-password"
          className="w-full mt-4 bg-white/5 border border-white/20 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#f8c8fc] transition-all"
        />
        {error && <p className="text-red-500 text-sm mt-2 text-center">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full mt-6 bg-[#e97bfc] text-black font-bold py-3 px-6 rounded-lg text-lg transition-all duration-300 hover:scale-105 hover:shadow-lg hover:shadow-[#e97bfc]/50 active:scale-95 disabled:opacity-50 disabled:hover:scale-100"
        >
          {busy ? 'Checking…' : 'Authenticate'}
        </button>
      </form>
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
    return <main className="min-h-screen bg-gray-900" />;
  }

  if (!creds) {
    return (
      <main className="min-h-screen bg-gray-900 text-white flex items-center justify-center p-4">
        <LoginForm title={title} onLogin={handleLogin} error={error} setError={setError} />
      </main>
    );
  }

  return <>{children({ creds, logout })}</>;
}
