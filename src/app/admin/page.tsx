// app/admin/page.tsx

import SyncButton from '@/components/SyncButton'; // Make sure this path is correct

export default function AdminDashboard() {
  return (
    <div style={{ padding: '2rem' }}>
      <h1>Admin Controls</h1>
      <p>
        Use the button below to pull all data from the PostgreSQL database
        and sync it to your Google Sheet.
      </p>
      <SyncButton />
    </div>
  );
}