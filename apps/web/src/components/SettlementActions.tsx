'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function SettlementActions({ id, type }: { id: string; type: 'purchase' | 'cashout' }) {
  const router = useRouter();
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState('');
  const [paymentRef, setPaymentRef] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function act(action: 'approve' | 'reject') {
    if (action === 'reject' && !reason.trim()) { setError('Reason required'); return; }
    setLoading(true);
    setError('');

    const body: Record<string, string> = { type };
    if (action === 'reject') body['reason'] = reason;
    if (action === 'approve' && paymentRef) body['paymentRef'] = paymentRef;

    const res = await fetch(`/api/admin/settlement/${id}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setLoading(false);

    if (res.ok) {
      router.refresh();
    } else {
      const data = await res.json() as { error?: string };
      setError(data.error ?? 'Failed');
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {!showReject ? (
        <div className="flex gap-2">
          <button
            onClick={() => act('approve')}
            disabled={loading}
            className="text-xs bg-green-700 hover:bg-green-600 text-white px-2 py-1 rounded disabled:opacity-40"
          >
            Approve
          </button>
          <button
            onClick={() => setShowReject(true)}
            disabled={loading}
            className="text-xs bg-red-800 hover:bg-red-700 text-white px-2 py-1 rounded disabled:opacity-40"
          >
            Reject
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-end gap-1">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Rejection reason (required)"
            className="text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white w-48"
          />
          <div className="flex gap-1">
            <button
              onClick={() => act('reject')}
              disabled={loading || !reason.trim()}
              className="text-xs bg-red-700 hover:bg-red-600 text-white px-2 py-1 rounded disabled:opacity-40"
            >
              Confirm reject
            </button>
            <button
              onClick={() => setShowReject(false)}
              className="text-xs text-gray-400 hover:text-white px-2 py-1"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <p className="text-red-400 text-xs">{error}</p>}
    </div>
  );
}
