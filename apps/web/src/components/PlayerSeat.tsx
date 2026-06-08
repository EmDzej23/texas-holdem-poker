'use client';

import type { PublicSeatView } from '@poker/shared';
import { Card } from './Card';
import { formatCents } from '@/lib/format';

interface PlayerSeatProps {
  seat: PublicSeatView;
  isDealer: boolean;
  isActing: boolean;
  myPlayerId: string;
  myHoleCards?: [string, string] | undefined;
  seatPosition: { top: string; left: string };
  onSit?: (seatIndex: number) => void;
  sessionLoading: boolean;
  isLoggedIn: boolean;
  revealedCards?: [string, string] | undefined;
}

export function PlayerSeat({
  seat,
  isDealer,
  isActing,
  myPlayerId,
  myHoleCards,
  seatPosition,
  onSit,
  sessionLoading,
  isLoggedIn,
  revealedCards,
}: PlayerSeatProps) {
  const isMe = seat.playerId === myPlayerId;
  const isEmpty = seat.status === 'empty';
  const isFolded = seat.status === 'folded';
  const cards = isMe ? myHoleCards : (revealedCards ?? undefined);
  const showFaceDown = !isMe && !revealedCards && !isEmpty && seat.status !== 'waiting';

  return (
    <div
      className="absolute transform -translate-x-1/2 -translate-y-1/2"
      style={{ top: seatPosition.top, left: seatPosition.left }}
    >
      <div
        className={`
          flex flex-col items-center gap-1
          ${isActing ? 'drop-shadow-[0_0_12px_rgba(250,204,21,0.9)]' : ''}
          ${isFolded ? 'opacity-40' : ''}
        `}
      >
        {/* Cards */}
        <div className="flex gap-1 mb-1">
          {isEmpty ? null : showFaceDown ? (
            <>
              <Card faceDown small />
              <Card faceDown small />
            </>
          ) : cards ? (
            <>
              <Card card={cards[0]} small />
              <Card card={cards[1]} small />
            </>
          ) : null}
        </div>

        {/* Seat circle */}
        {isEmpty ? (
          <button
            disabled={sessionLoading}
            onClick={() => onSit?.(seat.seatIndex)}
            className="w-20 h-20 rounded-full border-2 border-dashed border-gray-400 text-gray-400 text-xs hover:border-yellow-400 hover:text-yellow-400 disabled:opacity-40 disabled:cursor-wait transition-colors flex items-center justify-center"
          >
            {sessionLoading ? '…' : isLoggedIn ? 'Sit' : 'Login'}
          </button>
        ) : (
          <div
            className={`
              w-20 h-20 rounded-full border-2 flex flex-col items-center justify-center text-center
              ${isMe ? 'border-yellow-400 bg-yellow-900/40' : 'border-gray-400 bg-gray-800/60'}
              ${isActing ? 'border-yellow-300' : ''}
              ${!seat.isConnected ? 'opacity-50' : ''}
            `}
          >
            <span className="text-white text-xs font-semibold truncate w-16 px-1">
              {seat.displayName}
            </span>
            <span className="text-green-400 text-xs font-bold">
              {formatCents(seat.stackCents)}
            </span>
            {seat.currentStreetBetCents > 0 && (
              <span className="text-yellow-300 text-[10px]">
                {formatCents(seat.currentStreetBetCents)}
              </span>
            )}
          </div>
        )}

        {/* Dealer button */}
        {isDealer && !isEmpty && (
          <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-white border border-gray-800 text-gray-800 text-[10px] font-bold flex items-center justify-center shadow">
            D
          </div>
        )}

        {/* Acting timer indicator */}
        {isActing && !isEmpty && (
          <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-16 h-1 bg-gray-700 rounded-full overflow-hidden">
            <div className="h-full bg-yellow-400 rounded-full animate-[shrink_30s_linear_forwards]" />
          </div>
        )}
      </div>
    </div>
  );
}
