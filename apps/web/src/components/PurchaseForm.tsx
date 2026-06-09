'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const QUICK_AMOUNTS = [500, 1000, 2000, 5000, 10000]; // cents

export function PurchaseForm() {
  const router = useRouter();
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [added, setAdded] = useState<number | null>(null);

  const cents = Math.round(parseFloat(amount) * 100);
  const valid = Number.isFinite(cents) && cents >= 100;

  async function submit(amountCents: number) {
    setError('');
    setAdded(null);
    setLoading(true);
    const res = await fetch('/api/player/deposit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amountCents }),
    });
    setLoading(false);
    if (res.ok) {
      const data = await res.json() as { walletBalanceCents: number };
      setAdded(amountCents);
      setAmount('');
      router.refresh();
      setTimeout(() => setAdded(null), 3000);
      void data;
    } else {
      const data = await res.json() as { error?: string };
      setError(data.error ?? 'Failed to add funds');
    }
  }

  return (
    <div className="space-y-3">
      {/* Quick-pick buttons */}
      <div className="flex flex-wrap gap-2">
        {QUICK_AMOUNTS.map((a) => (
          <button
            key={a}
            type="button"
            disabled={loading}
            onClick={() => void submit(a)}
            className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-600 text-sm font-medium disabled:opacity-40"
          >
            +{(a / 100).toFixed(0)}
          </button>
        ))}
      </div>

      {/* Custom amount */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) void submit(cents);
        }}
        className="flex gap-2"
      >
        <div className="flex items-center gap-1 flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3">
          <span className="text-gray-400 text-sm">$</span>
          <input
            type="number"
            min="1"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="custom amount"
            className="flex-1 bg-transparent py-2 text-white focus:outline-none text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !valid}
          className="px-4 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-40 text-white text-sm font-semibold rounded-lg"
        >
          {loading ? '…' : 'Add'}
        </button>
      </form>

      {error && <p className="text-red-400 text-xs">{error}</p>}
      {added !== null && (
        <p className="text-green-400 text-xs">
          +${(added / 100).toFixed(2)} added to your balance.
        </p>
      )}
    </div>
  );
}
