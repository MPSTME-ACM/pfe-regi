'use client';

import { useEffect, useState } from 'react';
import { Bar, Pie, Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  BarElement,
  CategoryScale,
  LinearScale,
  ArcElement,
  Tooltip,
  Legend,
  PointElement,
  LineElement,
} from 'chart.js';

ChartJS.register(
  BarElement,
  CategoryScale,
  LinearScale,
  ArcElement,
  Tooltip,
  Legend,
  PointElement,
  LineElement
);

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
    <div className="w-full max-w-sm p-8 0 backdrop-blur-md rounded-2xl border border-white/10 shadow-2xl shadow-[#e97bfc]/10">
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

const StatsPage = () => {
  const [authCreds, setAuthCreds] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    const creds = sessionStorage.getItem('admin-creds');
    if (!creds) {
      setError('Not authenticated');
      return;
    }
    setAuthCreds(creds);
  }, []);

  useEffect(() => {
    if (!authCreds) return;
    const fetchStats = async () => {
      try {
        const res = await fetch('/api/stats', {
          headers: {
            Authorization: authCreds!,
          },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Failed to fetch stats');
        setStats(data);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, [authCreds]);

    const handleLogin = async () => {
    if (!username || !password) {
      setError('Username and password are required.');
      return;
    }

    const creds = `Basic ${btoa(`${username}:${password}`)}`;

    try {
      const res = await fetch('/api/login', {
        headers: { Authorization: creds },
      });

      if (!res.ok) {
        setError('Invalid username or password');
        return;
      }

      sessionStorage.setItem('admin-creds', creds);
      setAuthCreds(creds);
      setError('');
    } catch (err) {
      setError('Network error during authentication');
    }
  };

  if (!authCreds) {
    return (
      <main className="min-h-screen bg-gray-900 text-white flex items-center justify-center p-4">
        <div className="w-full max-w-sm p-8 backdrop-blur-md rounded-2xl border border-white/10 shadow-2xl shadow-[#e97bfc]/10">
          <h2 className="text-2xl font-bold text-center mb-6">Admin Login</h2>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username"
            className="w-full bg-white/5 border border-white/20 rounded-lg px-4 py-3 mb-4 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#f8c8fc]"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full bg-white/5 border border-white/20 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#f8c8fc]"
          />
          {error && <p className="text-red-500 text-sm mt-2 text-center">{error}</p>}
          <button
            onClick={handleLogin}
            className="w-full mt-6 bg-[#e97bfc] text-black font-bold py-3 px-6 rounded-lg text-lg hover:scale-105 transition-all"
          >
            Authenticate
          </button>
        </div>
      </main>
    );
  }
  
  const handleLogout = () => {
    sessionStorage.removeItem('admin-creds');
    setAuthCreds(null);
    window.location.reload();
  };

  if (!authCreds) {
    return (
      <main className="min-h-screen bg-gray-800 text-white flex items-center justify-center px-4">
        <p className="text-xl">{error || 'Authentication required'}</p>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-800 text-white flex items-center justify-center px-4">
        <p>Loading stats...</p>
      </main>
    );
  }

  if (!stats) {
    return (
      <main className="min-h-screen bg-gray-800 text-white flex items-center justify-center px-4">
        <p>Error: {error || 'Something went wrong'}</p>
      </main>
    );
  }

  // Domain-wise successful registrations as Line Chart
  const domainChart = {
    labels: Object.keys(stats.domains),
    datasets: [
      {
        label: 'Successful Registrations',
        data: Object.values(stats.domains),
        borderColor: '#8b5cf6', // violet-500
        backgroundColor: 'rgba(139, 92, 246, 0.2)',
        fill: true,
        tension: 0.3,
        pointRadius: 5,
        pointHoverRadius: 7,
      },
    ],
  };

  // Year-wise registrations Pie chart data (same but smaller size)
  const yearLabels = Object.keys(stats.years);
  const yearData = Object.values(stats.years);
  const yearColors = ['#22d3ee', '#4ade80']; // cyan-400, green-400

  const yearChart = {
    labels: yearLabels,
    datasets: [
      {
        label: 'Registrations',
        data: yearData,
        backgroundColor: yearColors.slice(0, yearData.length),
        borderRadius: 6,
      },
    ],
  };

  // Registration status chart (Bar chart)
  const statusChart = {
    labels: ['Successful', 'Pending'],
    datasets: [
      {
        label: 'Registration Status',
        data: [stats.total, stats.pending || 0], // successful and pending counts
        backgroundColor: ['#22c55e', '#facc15'], // green and yellow
        borderRadius: 6,
      },
    ],
  };

  // Daily registrations as Line chart data preparation
  const dailyLabels = Object.keys(stats.daily);
  const dailySuccess = dailyLabels.map((day) => stats.daily[day].success);
  const dailyPending = dailyLabels.map((day) => stats.daily[day].pending);

  const dailyChart = {
    labels: dailyLabels,
    datasets: [
      {
        label: 'Success',
        data: dailySuccess,
        borderColor: '#22c55e',
        backgroundColor: 'rgba(34, 197, 94, 0.2)',
        fill: true,
        tension: 0.3,
        pointRadius: 4,
        pointHoverRadius: 6,
      },
      {
        label: 'Pending',
        data: dailyPending,
        borderColor: '#facc15',
        backgroundColor: 'rgba(250, 204, 21, 0.2)',
        fill: true,
        tension: 0.3,
        pointRadius: 4,
        pointHoverRadius: 6,
      },
    ],
  };

  return (
  <main className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white px-4 py-6 flex flex-col items-center">
    <div className="w-full max-w-7xl">
      <header className="flex justify-between items-center mb-3">
        <h1 className="text-3xl font-extrabold tracking-tight">Admin Statistics</h1>
        <button
          onClick={handleLogout}
          className="bg-gray-700 hover:bg-gray-600 transition px-3 py-1.5 rounded-md text-sm font-semibold shadow-md"
        >
          Logout
        </button>
      </header>

      {/* KPI Cards with reduced gap */}
      <section className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <KPI title="✅ Successful" value={stats.total} color="green" />
        <KPI title="📋 Total Registered" value={stats.totalAll} color="blue" />
        <KPI title="🕒 Pending" value={stats.pending} color="yellow" />
        <KPI title="📊 Success %" value={`${stats.successPercent.toFixed(1)}%`} color="purple" />
      </section>

      {/* Charts with reduced gaps */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ChartCard title="Domain-wise Successful Registrations">
          <Bar
            data={domainChart}
            options={{
              responsive: true,
              plugins: {
                legend: { position: 'top', labels: { color: '#ddd' } },
                tooltip: { enabled: true },
              },
              scales: {
                x: { ticks: { color: '#ccc' }, grid: { display: true, color: '#444' }, border: { color: '#666' } },
                y: {
                  ticks: { color: '#ccc' },
                  grid: { color: '#444' },
                  beginAtZero: true,
                  border: { color: '#666' },
                },
              },
            }}
          />
        </ChartCard>

        <ChartCard title="Registration Status">
          <Bar
            data={statusChart}
            options={{
              responsive: true,
              plugins: {
                legend: { position: 'top', labels: { color: '#ddd' } },
                tooltip: { enabled: true },
              },
              scales: {
                x: { ticks: { color: '#ccc' }, grid: { display: false } },
                y: { ticks: { color: '#ccc' }, grid: { color: '#444' }, beginAtZero: true },
              },
            }}
          />
        </ChartCard>

        <ChartCard title="Year-wise Registrations">
          <div style={{ width: 300, height: 300, margin: '0 auto' }}>
            <Pie
              data={yearChart}
              options={{
                responsive: true,
                plugins: {
                  legend: { position: 'top', labels: { color: '#ddd' } },
                  tooltip: { enabled: true },
                },
                maintainAspectRatio: false,
              }}
            />
          </div>
        </ChartCard>

        <ChartCard title="Daily Registrations (Last 10 Days)">
          <Line
            data={dailyChart}
            options={{
              responsive: true,
              plugins: {
                legend: { position: 'top', labels: { color: '#ddd' } },
                tooltip: { enabled: true },
              },
              scales: {
                x: { ticks: { color: '#ccc' }, grid: { display: true, color: '#444' }, border: { color: '#666' } },
                y: {
                  ticks: { color: '#ccc' },
                  grid: { color: '#444' },
                  beginAtZero: true,
                  border: { color: '#666' },
                },
              },
              interaction: { mode: 'nearest', intersect: false },
            }}
          />
        </ChartCard>
      </section>
    </div>
  </main>
);
}

const KPI = ({
  title,
  value,
  color,
}: {
  title: string;
  value: string | number;
  color: 'green' | 'blue' | 'yellow' | 'purple';
}) => {
  const colors = {
    green: 'text-green-400 bg-green-900/20',
    blue: 'text-sky-400 bg-sky-900/20',
    yellow: 'text-yellow-400 bg-yellow-900/20',
    purple: 'text-purple-400 bg-purple-900/20',
  };

  return (
    <div
      className={`flex flex-col items-center justify-center rounded-lg border border-white/10 p-2.5 shadow-md ${colors[color]}`}
    >
      <p className="text-xs sm:text-sm font-medium mb-1">{title}</p>
      <p className="text-2xl sm:text-3xl font-bold">{value}</p>
    </div>
  );
};

const ChartCard = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="bg-gray-800 rounded-lg p-2.5 shadow-lg border border-white/10">
    <h2 className="text-lg sm:text-xl font-semibold mb-3">{title}</h2>
    {children}
  </div>
);

export default StatsPage;
