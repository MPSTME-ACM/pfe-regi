// app/sync/page.tsx

'use client';

import { useEffect, useState } from 'react';

const AdminLogin = ({
  onLogin,
  error,
  setError,
}: {
  onLogin: (user: string, pass: string) => void;
  error: string;
  setError: (err: string) => void;
}) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setError('Username and Password are required.');
      return;
    }
    setError('');
    onLogin(username, password);
  };

  return (
    <div className="w-full max-w-sm p-8 bg-black/50 backdrop-blur-md rounded-2xl border border-white/10 shadow-2xl shadow-[#e97bfc]/10">
      <h2 className="text-2xl font-bold text-center text-white mb-6">Admin Verification</h2>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Username"
          className="w-full bg-white/5 border border-white/20 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#f8c8fc] transition-all"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="w-full mt-4 bg-white/5 border border-white/20 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#f8c8fc] transition-all"
        />
        {error && <p className="text-red-500 text-sm mt-2 text-center">{error}</p>}
        <button
          type="submit"
          className="w-full mt-6 bg-[#e97bfc] text-black font-bold py-3 px-6 rounded-lg text-lg transition-all duration-300 ease-in-out transform hover:scale-105 hover:shadow-lg hover:shadow-[#e97bfc]/50 active:scale-95"
        >
          Authenticate
        </button>
      </form>
    </div>
  );
};

const SyncButton = () => {
  const [isLoading, setIsLoading] = useState(false);

  const handleSync = async () => {
    setIsLoading(true);
    const creds = sessionStorage.getItem('admin-creds');

    if (!creds) {
      alert('Unauthorized: Please log in as admin.');
      setIsLoading(false);
      return;
    }

    try {
      const response = await fetch('/api/sync-sheet', {
        method: 'POST',
        headers: {
          Authorization: creds,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          alert('Authentication failed. Please log in again.');
          sessionStorage.removeItem('admin-creds');
          window.location.reload();
        } else {
          alert(`Sync failed: ${data.message || data.error || 'Unknown error'}`);
        }
      } else {
        alert(`${data.message || 'Data synced successfully!'}`);
      }
    } catch (error: unknown) {
      if (error instanceof Error) {
        alert('Sync failed: ' + error.message);
      } else {
        alert('Sync failed: ' + String(error));
      }
    }
    setIsLoading(false);
  };

  return (
    <button
      onClick={handleSync}
      disabled={isLoading}
      className="bg-blue-500 text-white px-4 py-2 rounded transition hover:bg-blue-600 disabled:opacity-50"
    >
      {isLoading ? 'Syncing...' : 'Sync to Google Sheets'}
    </button>
  );
};

export default function SyncPage() {
  const [authCreds, setAuthCreds] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const storedCreds = sessionStorage.getItem('admin-creds');
    if (storedCreds) {
      setAuthCreds(storedCreds);
    }
  }, []);

  const handleLogin = async (user: string, pass: string) => {
    const creds = `Basic ${btoa(`${user}:${pass}`)}`;

    try {
      const res = await fetch('/api/login', {
        headers: { Authorization: creds },
      });
      if (!res.ok) {
        setError('Invalid username or password');
        return;
      }
      setError('');
      sessionStorage.setItem('admin-creds', creds);
      setAuthCreds(creds);
    } catch {
      setError('Network error during authentication');
    }
  };

  const handleLogout = () => {
    sessionStorage.removeItem('admin-creds');
    setAuthCreds(null);
    setError('');
  };

  if (!authCreds) {
    return (
      <main className="min-h-screen bg-gray-900 text-white flex items-center justify-center p-4">
        <AdminLogin onLogin={handleLogin} error={error} setError={setError} />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-900 text-white p-8 relative">
      <button
        onClick={handleLogout}
        className="absolute top-4 right-4 text-sm text-gray-300 hover:text-white transition-colors bg-black/30 px-3 py-2 rounded-lg backdrop-blur-sm border border-white/10"
      >
        Logout
      </button>

      <h1 className="text-3xl font-bold mb-4">Admin Controls</h1>
      <p className="mb-6 text-gray-400">
        Click the button below to sync all registrations to your connected Google Sheet.
      </p>

      <SyncButton />
    </main>
  );
}
