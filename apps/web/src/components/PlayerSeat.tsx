'use client';

import type { PublicSeatView } from '@poker/shared';
import { Card } from './Card';

interface PlayerSeatProps {
  seat: PublicSeatView;
  isDealer: boolean;
  isSB: boolean;
  isBB: boolean;
  isActing: boolean;
  myPlayerId: string;
  myHoleCards?: [string, string] | undefined;
  seatPosition: { top: string; left: string };
  onSit?: (seatIndex: number) => void;
  sessionLoading: boolean;
  isLoggedIn: boolean;
  revealedCards?: [string, string] | undefined;
  fmt: (cents: number) => string;
}

export function PlayerSeat({
  seat,
  isDealer,
  isSB,
  isBB,
  isActing,
  myPlayerId,
  myHoleCards,
  seatPosition,
  onSit,
  sessionLoading,
  isLoggedIn,
  revealedCards,
  fmt,
}: PlayerSeatProps) {
  const isMe = seat.playerId === myPlayerId;
  const isEmpty = seat.status === 'empty';
  const isFolded = seat.status === 'folded';
  const cards = isMe ? myHoleCards : (revealedCards ?? undefined);
  const showFaceDown = !isMe && !revealedCards && !isEmpty && seat.status !== 'waiting';

  return (
    <div
      className="absolute transform -translate-x-1/2 -translate-y-1/2 z-20"
      style={{ top: seatPosition.top, left: seatPosition.left }}
    >
      <div
        className={`
          flex flex-col items-center gap-0.5
          ${isActing ? 'drop-shadow-[0_0_12px_rgba(250,204,21,0.9)]' : ''}
          ${isFolded ? 'opacity-40' : ''}
        `}
      >
        {/* Cards */}
        <div className="flex gap-0.5 mb-0.5">
          {isEmpty ? null : showFaceDown ? (
            <div key="facedown" className="flex gap-0.5" style={{ perspective: '400px' }}>
              <Card faceDown small />
              <Card faceDown small />
            </div>
          ) : cards ? (
            <div key={cards[0]} className="flex gap-0.5" style={{ perspective: '400px' }}>
              <Card card={cards[0]} small />
              <Card card={cards[1]} small />
            </div>
          ) : null}
        </div>

        {/* Seat circle */}
        {isEmpty ? (
          <button
            disabled={sessionLoading}
            onClick={() => onSit?.(seat.seatIndex)}
            className="w-14 h-14 sm:w-16 sm:h-16 md:w-20 md:h-20 rounded-full border-2 border-dashed border-gray-400 text-gray-400 text-[10px] sm:text-xs hover:border-yellow-400 hover:text-yellow-400 disabled:opacity-40 disabled:cursor-wait transition-colors flex items-center justify-center"
          >
            {sessionLoading ? '…' : isLoggedIn ? 'Sit' : 'Login'}
          </button>
        ) : (
          <div
            className={`
              relative w-14 h-14 sm:w-16 sm:h-16 md:w-20 md:h-20 rounded-full border-2 flex flex-col items-center justify-center text-center
              ${isMe ? 'border-yellow-400 bg-yellow-900/40' : 'border-gray-400 bg-gray-800/60'}
              ${isActing ? 'border-yellow-300' : ''}
              ${!seat.isConnected ? 'opacity-50' : ''}
            `}
          >
            <span className="text-white text-[9px] sm:text-[10px] md:text-xs font-semibold truncate w-12 md:w-16 px-1">
              {seat.displayName}
            </span>
            <span key={seat.stackCents} className="text-green-400 text-[9px] sm:text-[10px] md:text-xs font-bold animate-stack-flash">
              {fmt(seat.stackCents)}
            </span>
            {seat.currentStreetBetCents > 0 && (
              <span key={seat.currentStreetBetCents} className="text-yellow-300 text-[8px] sm:text-[9px] md:text-[10px] animate-chip">
                {fmt(seat.currentStreetBetCents)}
              </span>
            )}

            {/* Dealer button */}
            {isDealer && (
              <div className="absolute -top-1 -right-1 w-5 h-5 md:w-6 md:h-6 rounded-full bg-white border-2 border-gray-800 text-gray-800 text-[8px] md:text-[10px] font-bold flex items-center justify-center shadow-md z-30">
                D
              </div>
            )}

            {/* Small blind chip */}
            {isSB && !isEmpty && (
              <div className="absolute -top-1 -left-1 w-5 h-5 md:w-6 md:h-6 rounded-full bg-blue-500 border border-blue-300 text-white text-[7px] md:text-[9px] font-bold flex items-center justify-center shadow-md z-30">
                SB
              </div>
            )}

            {/* Big blind chip */}
            {isBB && !isEmpty && (
              <div className="absolute top-4 md:top-5 -left-1 w-5 h-5 md:w-6 md:h-6 rounded-full bg-red-500 border border-red-300 text-white text-[7px] md:text-[9px] font-bold flex items-center justify-center shadow-md z-30">
                BB
              </div>
            )}
          </div>
        )}

        {/* Acting timer indicator */}
        {isActing && !isEmpty && (
          <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-12 md:w-16 h-1 bg-gray-700 rounded-full overflow-hidden">
            <div className="h-full bg-yellow-400 rounded-full animate-shrink" />
          </div>
        )}
      </div>
    </div>
  );
}
