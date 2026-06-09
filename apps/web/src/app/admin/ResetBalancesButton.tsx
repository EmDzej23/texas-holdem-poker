'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function ResetBalancesButton() {
  const router = useRouter();
  const [status, setStatus] = useState<'idle' | 'confirm' | 'loading' | 'done'>('idle');
  const [error, setError] = useState('');

  async function handle() {
    if (status === 'loading') return;
    if (status !== 'confirm') { setStatus('confirm'); return; }

    setStatus('loading');
    setError('');
    const res = await fetch('/api/admin/reset-balances', { method: 'DELETE' });
    if (res.ok) {
      setStatus('done');
      router.refresh();
      setTimeout(() => setStatus('idle'), 3000);
    } else {
      const body = await res.json() as { error?: string };
      setError(body.error ?? 'Failed');
      setStatus('idle');
    }
  }

  return (
    <div className="border border-gray-800 rounded-xl p-5 space-y-2">
      <h2 className="font-semibold text-sm text-gray-300">Danger zone</h2>
      <p className="text-xs text-gray-500">
        Reset all player balances to zero. Wipes the entire ledger. Hand history is preserved.
      </p>
      <div className="flex items-center gap-3">
        <button
          onClick={() => void handle()}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
            status === 'confirm'
              ? 'bg-red-600 hover:bg-red-500 text-white animate-pulse'
              : status === 'done'
              ? 'bg-green-800 text-white'
              : 'bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-600'
          }`}
        >
          {status === 'idle' && 'Reset all balances'}
          {status === 'confirm' && 'Confirm — this cannot be undone'}
          {status === 'loading' && 'Resetting…'}
          {status === 'done' && '✓ Balances reset'}
        </button>
        {status === 'confirm' && (
          <button
            onClick={() => setStatus('idle')}
            className="text-xs text-gray-500 hover:text-gray-300"
          >
            Cancel
          </button>
        )}
      </div>
      {error && <p className="text-red-400 text-xs">{error}</p>}
    </div>
  );
}
