'use client';

import { useState } from 'react';
import { Card } from './Card';

interface HandVerifierProps {
  prefill?: {
    serverSeed: string;
    clientSeed: string;
    shuffleIndex: number;
    serverSeedHash: string;
    handId: string;
  };
}

export function HandVerifier({ prefill }: HandVerifierProps) {
  const [serverSeed, setServerSeed] = useState(prefill?.serverSeed ?? '');
  const [clientSeed, setClientSeed] = useState(prefill?.clientSeed ?? '');
  const [shuffleIndex, setShuffleIndex] = useState(String(prefill?.shuffleIndex ?? '0'));
  const [publishedHash, setPublishedHash] = useState(prefill?.serverSeedHash ?? '');
  const [result, setResult] = useState<{ valid: boolean; deck: string[] } | null>(null);

  async function verify() {
    const params = new URLSearchParams({ serverSeed, clientSeed, shuffleIndex, publishedHash });
    const res = await fetch(`/api/verify?${params}`);
    const r = await res.json() as { valid: boolean; deck: string[] };
    setResult(r);
  }

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 max-w-2xl mx-auto">
      <h2 className="text-white text-xl font-bold mb-4">Verify Hand Fairness</h2>
      <p className="text-gray-400 text-sm mb-4">
        After each hand, the server reveals its seed. Enter the values below to reproduce
        the deterministic shuffle and verify the deck order.
      </p>

      <div className="space-y-3">
        {[
          { label: 'Server Seed (revealed after hand)', value: serverSeed, setter: setServerSeed },
          { label: 'Published Hash (SHA-256 of server seed)', value: publishedHash, setter: setPublishedHash },
          { label: 'Client Seed', value: clientSeed, setter: setClientSeed },
        ].map(({ label, value, setter }) => (
          <div key={label}>
            <label className="text-gray-400 text-xs mb-1 block">{label}</label>
            <input
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm font-mono"
              value={value}
              onChange={(e) => setter(e.target.value)}
            />
          </div>
        ))}
        <div>
          <label className="text-gray-400 text-xs mb-1 block">Shuffle Index</label>
          <input
            className="w-40 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm font-mono"
            value={shuffleIndex}
            onChange={(e) => setShuffleIndex(e.target.value)}
            type="number"
            min="0"
          />
        </div>
      </div>

      <button
        onClick={() => { void verify(); }}
        className="mt-4 px-6 py-2 bg-yellow-500 hover:bg-yellow-400 text-black font-bold rounded-lg transition-colors"
      >
        Verify Shuffle
      </button>

      {result !== null && (
        <div className="mt-4">
          {result.valid ? (
            <>
              <p className="text-green-400 font-semibold mb-2">✓ Seed verified — deck order:</p>
              <div className="flex flex-wrap gap-1 max-h-48 overflow-y-auto">
                {result.deck.map((card, i) => (
                  <div key={i} className="flex flex-col items-center">
                    <span className="text-gray-500 text-[10px]">{i + 1}</span>
                    <Card card={card} small />
                  </div>
                ))}
              </div>
              <p className="text-gray-400 text-xs mt-2">
                Cards 1–2 = seat 1 hole cards, 3–4 = seat 2, …
                Then burn + 3 flop, burn + turn, burn + river.
              </p>
            </>
          ) : (
            <p className="text-red-400 font-semibold">
              ✗ Verification failed — hash does not match provided server seed.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
