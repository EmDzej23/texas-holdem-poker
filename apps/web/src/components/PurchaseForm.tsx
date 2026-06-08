'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatMoney } from '@/lib/format';

export function PurchaseForm() {
  const router = useRouter();
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const tokens = Math.floor(Number(amount) * 100); // user enters dollars, we convert to cents/tokens

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (tokens < 100) { setError('Minimum $1.00'); return; }
    setLoading(true);

    const res = await fetch('/api/purchase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokenAmount: tokens }),
    });
    setLoading(false);

    if (res.ok) {
      setSuccess(`Request submitted for ${formatMoney(tokens)} · awaiting admin approval.`);
      setAmount('');
      router.refresh();
    } else {
      const data = await res.json() as { error?: string };
      setError(data.error ?? 'Failed');
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex gap-2 items-center">
        <span className="text-gray-400">$</span>
        <input
          type="number"
          min="1"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="10.00"
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-green-500"
        />
      </div>
      {tokens >= 100 && (
        <p className="text-xs text-gray-400">{tokens.toLocaleString()} tokens · you owe {formatMoney(tokens)} in real life</p>
      )}
      {error && <p className="text-red-400 text-xs">{error}</p>}
      {success && <p className="text-green-400 text-xs">{success}</p>}
      <button
        type="submit"
        disabled={loading || tokens < 100}
        className="w-full bg-green-700 hover:bg-green-600 disabled:opacity-40 text-white text-sm font-semibold py-2 rounded-lg transition"
      >
        {loading ? 'Submitting…' : 'Request tokens'}
      </button>
    </form>
  );
}
