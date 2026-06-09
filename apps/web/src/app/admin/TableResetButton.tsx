'use client';

import { useState } from 'react';

export function TableResetButton({ tableId }: { tableId: string }) {
  const [status, setStatus] = useState<'idle' | 'confirming' | 'loading' | 'done' | 'error'>('idle');

  async function handleReset() {
    if (status === 'loading') return;
    if (status !== 'confirming') { setStatus('confirming'); return; }

    setStatus('loading');
    try {
      const res = await fetch('/api/admin/table-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableId }),
      });
      setStatus(res.ok ? 'done' : 'error');
      if (res.ok) setTimeout(() => setStatus('idle'), 3000);
    } catch {
      setStatus('error');
    }
  }

  const labels: Record<typeof status, string> = {
    idle: `Reset ${tableId}`,
    confirming: 'Confirm reset?',
    loading: 'Resetting…',
    done: '✓ Reset done',
    error: 'Error — retry?',
  };

  const colors: Record<typeof status, string> = {
    idle:       'bg-gray-700 hover:bg-red-800 text-gray-200',
    confirming: 'bg-red-700 hover:bg-red-600 text-white animate-pulse',
    loading:    'bg-gray-600 text-gray-400 cursor-not-allowed',
    done:       'bg-green-700 text-white',
    error:      'bg-red-700 hover:bg-red-600 text-white',
  };

  return (
    <button
      onClick={handleReset}
      className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${colors[status]}`}
    >
      {labels[status]}
    </button>
  );
}
