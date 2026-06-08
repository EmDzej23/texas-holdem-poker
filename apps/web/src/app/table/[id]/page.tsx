'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { PokerTable } from '@/components/PokerTable';

export default function TablePage() {
  const params = useParams<{ id: string }>();
  const tableId = params.id;

  // In production: playerId comes from auth session.
  // TODO: replace with real auth (NextAuth / Clerk / custom JWT).
  const [playerId, setPlayerId] = useState('');
  const [joined, setJoined] = useState(false);

  if (!joined) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-sm">
          <h2 className="text-white font-bold mb-4">Join Table {tableId}</h2>
          <div className="mb-4">
            <label className="text-gray-400 text-sm mb-1 block">
              Player name (used as your ID)
            </label>
            <input
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white"
              value={playerId}
              onChange={(e) => setPlayerId(e.target.value)}
              placeholder="alice"
              onKeyDown={(e) => { if (e.key === 'Enter' && playerId.trim()) setJoined(true); }}
            />
          </div>
          <button
            onClick={() => { if (playerId.trim()) setJoined(true); }}
            disabled={!playerId.trim()}
            className="w-full py-2 bg-yellow-500 hover:bg-yellow-400 disabled:opacity-50 disabled:cursor-not-allowed text-black font-bold rounded-lg"
          >
            Enter Table
          </button>
        </div>
      </div>
    );
  }

  return <PokerTable tableId={tableId} playerId={playerId.trim()} />;
}
