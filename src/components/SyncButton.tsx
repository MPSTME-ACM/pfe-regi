'use client';
import { useState } from 'react';

export default function SyncButton() {
  const [isLoading, setIsLoading] = useState(false);
  
  const handleSync = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/sync-to-sheets', {
        method: 'POST',
      });
      const data = await response.json();
      
      if (data.success) {
        alert('Data synced successfully!');
      } else {
        alert('Sync failed: ' + data.error);
      }
    } catch (error) {
      alert('Sync failed: ' + error);
    }
    setIsLoading(false);
  };

  return (
    <button 
      onClick={handleSync} 
      disabled={isLoading}
      className="bg-blue-500 text-white px-4 py-2 rounded"
    >
      {isLoading ? 'Syncing...' : 'Sync to Google Sheets'}
    </button>
  );
}