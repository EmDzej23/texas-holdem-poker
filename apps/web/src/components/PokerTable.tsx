'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ValidAction } from '@poker/engine';
import { useTableSocket } from '@/hooks/useTableSocket';
import { PlayerSeat } from './PlayerSeat';
import { Card } from './Card';
import { BetControls } from './BetControls';
import { HandVerifier } from './HandVerifier';
import { formatCents } from '@/lib/format';

// ---------------------------------------------------------------------------
// Seat positions on the oval table (as % of container)
// For up to 9 seats arranged around an ellipse.
// ---------------------------------------------------------------------------
const SEAT_POSITIONS: { top: string; left: string }[] = [
  { top: '90%', left: '50%' },   // 0 — bottom center (hero default)
  { top: '75%', left: '80%' },   // 1
  { top: '40%', left: '92%' },   // 2
  { top: '12%', left: '75%' },   // 3
  { top: '10%', left: '50%' },   // 4
  { top: '12%', left: '25%' },   // 5
  { top: '40%', left: '8%' },    // 6
  { top: '75%', left: '20%' },   // 7
  { top: '90%', left: '50%' },   // 8 (only shown if maxSeats=9, seat 0 shifts)
];

interface PokerTableProps {
  tableId: string;
  playerId: string | null;
  sessionLoading?: boolean;
}

export function PokerTable({ tableId, playerId, sessionLoading = false }: PokerTableProps) {
  const router = useRouter();
  const {
    connected,
    tableState,
    myHoleCards,
    latestVerify,
    events,
    fold,
    check,
    call,
    bet,
    raise,
    allIn,
    sit,
  } = useTableSocket(tableId, playerId);

  const [showVerifier, setShowVerifier] = useState(false);
  const [buyInInput, setBuyInInput] = useState('');
  const [pendingSeatIndex, setPendingSeatIndex] = useState<number | null>(null);

  const mySeat = tableState?.seats.find((s) => s.playerId === playerId);
  const isMyTurn =
    tableState !== null &&
    tableState.actingSeatIndex !== -1 &&
    mySeat?.seatIndex === tableState.actingSeatIndex;

  // Derive valid actions from the latest turn:start event
  const validActions = useMemo<ValidAction[]>(() => {
    const last = [...events].reverse().find((e) => e.type === 'turn:start');
    if (!last || last.type !== 'turn:start') return [];
    if (last.seatIndex !== mySeat?.seatIndex) return [];
    return last.validActions;
  }, [events, mySeat?.seatIndex]);

  const totalPot = (tableState?.pots ?? []).reduce((s, p) => s + p.amountCents, 0);
  const config = tableState?.config;

  function handleSitClick(seatIndex: number) {
    if (!playerId) {
      router.push(`/login?redirect=/table/${tableId}`);
      return;
    }
    setPendingSeatIndex(seatIndex);
    setBuyInInput(String(config?.minBuyInCents ?? 4000));
  }

  function confirmSit() {
    if (pendingSeatIndex === null) return;
    const amount = parseInt(buyInInput, 10);
    if (isNaN(amount)) return;
    sit(pendingSeatIndex, amount);
    setPendingSeatIndex(null);
  }

  return (
    <div className="relative min-h-screen bg-gray-950 flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 bg-gray-900 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`} />
          <span className="text-gray-400 text-sm">Table {tableId}</span>
          {config && (
            <span className="text-gray-500 text-xs">
              {formatCents(config.smallBlindCents)}/{formatCents(config.bigBlindCents)} · rake {config.rakePercent}%
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {playerId ? (
            <span className="text-gray-400 text-sm">{playerId}</span>
          ) : (
            <a href="/login" className="text-xs px-3 py-1 rounded bg-yellow-500 hover:bg-yellow-400 text-black font-bold">
              Login to play
            </a>
          )}
          {mySeat && (
            <span className="text-green-400 text-sm font-semibold">
              {formatCents(mySeat.stackCents)}
            </span>
          )}
          {latestVerify && (
            <button
              onClick={() => setShowVerifier((v) => !v)}
              className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300"
            >
              {showVerifier ? 'Hide' : 'Verify hand'}
            </button>
          )}
        </div>
      </header>

      {/* Table surface */}
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="relative w-full max-w-3xl aspect-[16/10]">
          {/* Felt */}
          <div
            className="absolute inset-0 rounded-[50%] border-8 border-amber-900"
            style={{
              background: 'radial-gradient(ellipse at center, #166534 60%, #14532d 100%)',
              boxShadow: '0 0 60px rgba(0,0,0,0.8), inset 0 0 40px rgba(0,0,0,0.3)',
            }}
          />

          {/* Center info */}
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 z-10">
            {/* Community cards */}
            <div className="flex gap-2 mb-2">
              {Array.from({ length: 5 }).map((_, i) => {
                const card = tableState?.communityCards[i];
                return <Card key={i} card={card} faceDown={!card} small={false} />;
              })}
            </div>

            {/* Pot display */}
            {totalPot > 0 && (
              <div className="bg-black/40 rounded-full px-4 py-1">
                <span className="text-white font-bold text-sm">
                  Pot: {formatCents(totalPot)}
                </span>
                {(tableState?.pots ?? []).length > 1 && (
                  <span className="text-gray-300 text-xs ml-2">
                    ({(tableState?.pots ?? []).length} pots)
                  </span>
                )}
              </div>
            )}

            {/* Phase label */}
            {tableState?.phase && tableState.phase !== 'waiting' && (
              <span className="text-gray-300 text-xs uppercase tracking-widest opacity-70">
                {tableState.phase}
              </span>
            )}
          </div>

          {/* Seats */}
          {(tableState?.seats ?? []).map((seat) => {
            const pos = SEAT_POSITIONS[seat.seatIndex] ?? SEAT_POSITIONS[0]!;
            const isDealer = seat.seatIndex === tableState?.dealerSeatIndex;
            const isActing = seat.seatIndex === tableState?.actingSeatIndex;
            const isMe = seat.playerId === playerId;

            const revealedCardsEvt = events.find(
              (e): e is Extract<typeof e, { type: 'showdown' }> => e.type === 'showdown',
            );
            const revealedCards = revealedCardsEvt?.results.find(
              (r: { seatIndex: number }) => r.seatIndex === seat.seatIndex,
            )?.holeCards;

            return (
              <PlayerSeat
                key={seat.seatIndex}
                seat={seat}
                isDealer={isDealer}
                isActing={isActing}
                myPlayerId={playerId ?? ''}
                myHoleCards={isMe && myHoleCards ? myHoleCards.holeCards : undefined}
                seatPosition={pos}
                onSit={handleSitClick}
                sessionLoading={sessionLoading}
                isLoggedIn={playerId !== null}
                revealedCards={revealedCards}
              />
            );
          })}
        </div>
      </div>

      {/* Bet controls — only shown when it's my turn */}
      {isMyTurn && mySeat && config && (
        <BetControls
          validActions={validActions}
          potCents={totalPot}
          stackCents={mySeat.stackCents}
          currentBetCents={tableState?.currentBetCents ?? 0}
          myBetCents={mySeat.currentStreetBetCents}
          bigBlindCents={config.bigBlindCents}
          onFold={fold}
          onCheck={check}
          onCall={call}
          onBet={bet}
          onRaise={raise}
          onAllIn={allIn}
        />
      )}

      {/* Buy-in dialog */}
      {pendingSeatIndex !== null && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-80">
            <h3 className="text-white font-bold mb-4">Sit at Seat {pendingSeatIndex}</h3>
            <div className="mb-4">
              <label className="text-gray-400 text-sm mb-1 block">Buy-in (cents)</label>
              <input
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white"
                value={buyInInput}
                onChange={(e) => setBuyInInput(e.target.value)}
                type="number"
                min={config?.minBuyInCents ?? 0}
                max={config?.maxBuyInCents ?? 999999}
              />
              {config && (
                <p className="text-gray-500 text-xs mt-1">
                  {formatCents(config.minBuyInCents)} – {formatCents(config.maxBuyInCents)}
                </p>
              )}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setPendingSeatIndex(null)}
                className="flex-1 py-2 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600"
              >
                Cancel
              </button>
              <button
                onClick={confirmSit}
                className="flex-1 py-2 rounded-lg bg-yellow-500 hover:bg-yellow-400 text-black font-bold"
              >
                Sit Down
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hand verifier panel */}
      {showVerifier && latestVerify && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-2xl">
            <HandVerifier prefill={latestVerify} />
            <button
              onClick={() => setShowVerifier(false)}
              className="mt-3 w-full py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
