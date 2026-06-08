'use client';

import { useEffect, useRef } from 'react';
import { Card } from './Card';
import { formatCents } from '@/lib/format';

export interface WinnerDisplayInfo {
  displayName: string;
  playerId: string;
  amountCents: number;
  holeCards?: [string, string];
  handDescription?: string;
  isMe: boolean;
}

interface WinnerOverlayProps {
  winners: WinnerDisplayInfo[];
  isFoldWin: boolean;
  durationMs: number;
  onDismiss: () => void;
}

export function WinnerOverlay({ winners, isFoldWin, durationMs, onDismiss }: WinnerOverlayProps) {
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (barRef.current) {
      barRef.current.style.animation = `shrink ${durationMs / 1000}s linear forwards`;
    }
    const t = setTimeout(onDismiss, durationMs);
    return () => clearTimeout(t);
  }, [durationMs, onDismiss]);

  const isMultiWinner = winners.length > 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(3px)' }}
      onClick={onDismiss}
    >
      <div
        className="bg-gray-900 border-2 border-yellow-500/70 rounded-3xl shadow-2xl max-w-xs sm:max-w-sm w-full overflow-hidden"
        style={{ animation: 'winner-pop 0.5s cubic-bezier(0.22, 1, 0.36, 1) both, glow-pulse 1.6s 0.5s ease-in-out infinite' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-yellow-600/30 via-yellow-500/20 to-yellow-600/30 px-6 pt-5 pb-3 text-center">
          <div className="text-yellow-400 text-xs font-bold tracking-[0.25em] uppercase mb-1 opacity-80">
            {isMultiWinner ? 'Split Pot' : 'Winner'}
          </div>
          <div className="text-3xl sm:text-4xl font-black text-white tracking-tight leading-none">
            {winners.length === 1 && winners[0]!.isMe
              ? 'You Won!'
              : winners.map((w) => w.displayName).join(' & ')}
          </div>
          <div className="text-green-400 font-bold text-xl sm:text-2xl mt-1">
            {winners.length === 1
              ? `+${formatCents(winners[0]!.amountCents)}`
              : winners.map((w) => `+${formatCents(w.amountCents)}`).join(' / ')}
          </div>
        </div>

        {/* Cards + hand name section */}
        <div className="px-6 py-4">
          {isFoldWin ? (
            <p className="text-gray-400 text-sm text-center py-2">All other players folded</p>
          ) : (
            <div className={`flex ${isMultiWinner ? 'flex-col gap-4' : 'flex-col items-center gap-3'}`}>
              {winners.map((winner) => (
                <div key={winner.playerId} className="flex flex-col items-center gap-2">
                  {isMultiWinner && (
                    <span className="text-gray-300 text-xs font-semibold">{winner.displayName}</span>
                  )}
                  {winner.holeCards ? (
                    <div className="flex gap-2">
                      <div style={{ perspective: '400px' }}>
                        <Card card={winner.holeCards[0]} animate={false} />
                      </div>
                      <div style={{ perspective: '400px' }}>
                        <Card card={winner.holeCards[1]} animate={false} />
                      </div>
                    </div>
                  ) : null}
                  {winner.handDescription && (
                    <div className="text-center">
                      <div className="text-yellow-300 font-bold text-base sm:text-lg leading-tight">
                        {winner.handDescription}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Tap to dismiss hint */}
        <div className="text-center pb-3">
          <span className="text-gray-600 text-[10px] tracking-wider">tap to dismiss</span>
        </div>

        {/* Countdown bar */}
        <div className="h-1 bg-gray-800 relative overflow-hidden">
          <div ref={barRef} className="h-full bg-yellow-500 rounded-full" />
        </div>
      </div>
    </div>
  );
}
