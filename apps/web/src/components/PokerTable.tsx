'use client';

import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { ValidAction } from '@poker/engine';
import { useTableSocket } from '@/hooks/useTableSocket';
import { PlayerSeat } from './PlayerSeat';
import { Card } from './Card';
import { BetControls } from './BetControls';
import { HandVerifier } from './HandVerifier';
import { WinnerOverlay, type WinnerDisplayInfo } from './WinnerOverlay';
import { NewHandBanner } from './NewHandBanner';
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
  displayName?: string | null;
  sessionLoading?: boolean;
}

export function PokerTable({ tableId, playerId, displayName, sessionLoading = false }: PokerTableProps) {
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
    stand,
  } = useTableSocket(tableId, playerId, displayName ?? null);

  const [showVerifier, setShowVerifier] = useState(false);
  const [buyInInput, setBuyInInput] = useState('');
  const [pendingSeatIndex, setPendingSeatIndex] = useState<number | null>(null);
  const [walletBalanceCents, setWalletBalanceCents] = useState<number | null>(null);
  const [winnerData, setWinnerData] = useState<{ winners: WinnerDisplayInfo[]; isFoldWin: boolean } | null>(null);
  const [newHandDealerName, setNewHandDealerName] = useState<string | null>(null);
  const [newHandKey, setNewHandKey] = useState(0);

  // Use handId (unique per hand) as the dedup key — count-based refs fail across hands
  const lastShownCompleteHandId = useRef<string | null>(null);
  const lastShownStartedHandId = useRef<string | null>(null);

  const dismissWinner = useCallback(() => setWinnerData(null), []);

  // Single effect handles both hand:started and hand:complete via handId keying.
  // events[0] is always hand:started (useTableSocket resets to [evt] on each new hand).
  // events[events.length-1] is hand:complete at the end of a hand.
  useEffect(() => {
    if (events.length === 0) return;

    // ── New hand started ──────────────────────────────────────────────────────
    const firstEvt = events[0];
    if (firstEvt?.type === 'hand:started' && firstEvt.handId !== lastShownStartedHandId.current) {
      lastShownStartedHandId.current = firstEvt.handId;
      setWinnerData(null);
      const dealerSeat = tableState?.seats.find((s) => s.seatIndex === firstEvt.dealerSeat);
      setNewHandDealerName(dealerSeat?.displayName ?? null);
      setNewHandKey((k) => k + 1);
    }

    // ── Hand complete ─────────────────────────────────────────────────────────
    const lastEvt = events[events.length - 1];
    if (lastEvt?.type !== 'hand:complete') return;
    if (lastEvt.handId === lastShownCompleteHandId.current) return; // already processed
    lastShownCompleteHandId.current = lastEvt.handId;

    const awardedEvts = events.filter(
      (e): e is Extract<typeof e, { type: 'pot:awarded' }> => e.type === 'pot:awarded',
    );
    const showdownEvt = [...events].reverse().find(
      (e): e is Extract<typeof e, { type: 'showdown' }> => e.type === 'showdown',
    );

    const amountByPlayer = new Map<string, number>();
    for (const evt of awardedEvts) {
      for (const w of evt.winners) {
        amountByPlayer.set(w.playerId, (amountByPlayer.get(w.playerId) ?? 0) + w.amountCents);
      }
    }

    const seats = tableState?.seats ?? [];
    const winners: WinnerDisplayInfo[] = [...amountByPlayer.entries()].map(([pid, amt]) => {
      const seat = seats.find((s) => s.playerId === pid);
      const sdResult = showdownEvt?.results.find((r) => r.playerId === pid);
      return {
        displayName: seat?.displayName ?? pid,
        playerId: pid,
        amountCents: amt,
        holeCards: sdResult?.holeCards,
        handDescription: sdResult?.handDescription,
        isMe: pid === playerId,
      };
    });

    if (winners.length > 0) {
      setWinnerData({ winners, isFoldWin: !showdownEvt });
    }
  }, [events, tableState?.seats, playerId]);

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
  const sym = config?.currencySymbol ?? '$';
  const fmt = (c: number): string => formatCents(c, '');

  function handleSitClick(seatIndex: number) {
    if (!playerId) {
      router.push(`/login?redirect=/table/${tableId}`);
      return;
    }
    setPendingSeatIndex(seatIndex);
    setBuyInInput(String(config?.minBuyInCents ?? 4000));
    setWalletBalanceCents(null);
    fetch('/api/player/balance')
      .then((r) => r.json())
      .then((d: { balances?: { currencySymbol: string; balanceCents: number }[]; walletBalanceCents?: number }) => {
        // Show balance only for this table's currency
        const tableSym = config?.currencySymbol ?? '$';
        if (d.balances) {
          const match = d.balances.find((b) => b.currencySymbol === tableSym);
          setWalletBalanceCents(match?.balanceCents ?? 0);
        } else if (typeof d.walletBalanceCents === 'number') {
          setWalletBalanceCents(d.walletBalanceCents);
        }
      })
      .catch(() => {});
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
      <header className="flex flex-wrap items-center justify-between gap-2 px-3 sm:px-6 py-2 sm:py-3 bg-gray-900 border-b border-gray-800">
        <div className="flex items-center gap-2 sm:gap-3">
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${connected ? 'bg-green-400' : 'bg-red-400'}`} />
          <span className="text-gray-400 text-xs sm:text-sm">Table {tableId}</span>
          {config && (
            <span className="text-gray-500 text-xs hidden sm:inline">
              {fmt(config.smallBlindCents)}/{fmt(config.bigBlindCents)} · rake {config.rakePercent}%
            </span>
          )}
          {config && (
            <span className="text-gray-500 text-xs sm:hidden">
              {fmt(config.smallBlindCents)}/{fmt(config.bigBlindCents)}
            </span>
          )}
          {config && (
            <span className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-300 font-mono border border-gray-700">
              {sym}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          {playerId ? (
            <span className="text-gray-400 text-xs sm:text-sm truncate max-w-[80px] sm:max-w-none">{displayName ?? playerId}</span>
          ) : (
            <a href="/login" className="text-xs px-2 sm:px-3 py-1 rounded bg-yellow-500 hover:bg-yellow-400 text-black font-bold">
              Login
            </a>
          )}
          {mySeat && (
            <span className="text-green-400 text-xs sm:text-sm font-semibold">
              {fmt(mySeat.stackCents)}
            </span>
          )}
          {mySeat && (
            <button
              onClick={stand}
              className="text-xs px-2 sm:px-3 py-1 rounded bg-gray-700 hover:bg-red-700 text-gray-300 hover:text-white transition-colors"
            >
              Leave
            </button>
          )}
          {latestVerify && (
            <button
              onClick={() => setShowVerifier((v) => !v)}
              className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 hidden sm:inline"
            >
              {showVerifier ? 'Hide' : 'Verify'}
            </button>
          )}
        </div>
      </header>

      {/* Table surface */}
      <div className="flex-1 flex items-center justify-center p-2 sm:p-4 pb-24 sm:pb-28">
        <div className="relative w-full max-w-sm sm:max-w-xl md:max-w-3xl aspect-[16/10]">
          {/* Felt */}
          <div
            className="absolute inset-0 rounded-[50%] border-4 sm:border-8 border-amber-900"
            style={{
              background: 'radial-gradient(ellipse at center, #166534 60%, #14532d 100%)',
              boxShadow: '0 0 60px rgba(0,0,0,0.8), inset 0 0 40px rgba(0,0,0,0.3)',
            }}
          />

          {/* Center info */}
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 sm:gap-2 z-10 pointer-events-none">
            {/* Community cards */}
            <div className="flex gap-1 sm:gap-2 mb-1 sm:mb-2">
              {Array.from({ length: 5 }).map((_, i) => {
                const card = tableState?.communityCards[i];
                return (
                  <div key={card ?? `slot-${i}`} style={{ perspective: '600px' }}>
                    <Card card={card} faceDown={!card} />
                  </div>
                );
              })}
            </div>

            {/* Pot display */}
            {totalPot > 0 && (
              <div key={totalPot} className="bg-black/40 rounded-full px-3 py-0.5 sm:px-4 sm:py-1 animate-pot-grow">
                <span className="text-white font-bold text-xs sm:text-sm">
                  Pot: {fmt(totalPot)}
                </span>
                {(tableState?.pots ?? []).length > 1 && (
                  <span className="text-gray-300 text-xs ml-2">
                    ({(tableState?.pots ?? []).length})
                  </span>
                )}
              </div>
            )}

            {/* Phase label */}
            {tableState?.phase && tableState.phase !== 'waiting' && (
              <span className="text-gray-300 text-[10px] sm:text-xs uppercase tracking-widest opacity-70">
                {tableState.phase}
              </span>
            )}
          </div>

          {/* Seats */}
          {(tableState?.seats ?? []).map((seat) => {
            const pos = SEAT_POSITIONS[seat.seatIndex] ?? SEAT_POSITIONS[0]!;
            const isDealer = seat.seatIndex === tableState?.dealerSeatIndex;
            const isSB = seat.seatIndex === tableState?.sbSeatIndex;
            const isBB = seat.seatIndex === tableState?.bbSeatIndex;
            const isActing = seat.seatIndex === tableState?.actingSeatIndex;
            const isMe = seat.playerId === playerId;

            const revealedCardsEvt = [...events].reverse().find(
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
                isSB={isSB}
                isBB={isBB}
                isActing={isActing}
                myPlayerId={playerId ?? ''}
                myHoleCards={isMe && myHoleCards ? myHoleCards.holeCards : undefined}
                seatPosition={pos}
                onSit={handleSitClick}
                sessionLoading={sessionLoading}
                isLoggedIn={playerId !== null}
                revealedCards={revealedCards}
                fmt={fmt}
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
          fmt={fmt}
        />
      )}

      {/* Buy-in dialog */}
      {pendingSeatIndex !== null && (() => {
        const min = config?.minBuyInCents ?? 0;
        const max = config?.maxBuyInCents ?? 999999;
        // Clamp wallet balance to table limits
        const walletCapped = walletBalanceCents !== null
          ? Math.min(Math.max(walletBalanceCents, min), max)
          : null;
        return (
          <div className="fixed inset-0 bg-black/70 flex items-end sm:items-center justify-center z-50 p-4">
            <div className="bg-gray-900 border border-gray-700 rounded-2xl p-5 sm:p-6 w-full max-w-sm">
              <h3 className="text-white font-bold mb-1">Seat {pendingSeatIndex}</h3>
              <p className="text-gray-400 text-xs mb-4">Choose how much to bring to the table</p>

              {/* Wallet balance quick-pick */}
              {walletBalanceCents === null && (
                <div className="mb-3 text-gray-500 text-xs text-center py-2">Loading balance…</div>
              )}
              {walletBalanceCents !== null && walletBalanceCents <= 0 && (
                <div className="mb-3 bg-red-950/40 border border-red-800 rounded-lg px-3 py-2 text-red-400 text-xs">
                  Your wallet is empty.{' '}
                  <a href="/profile" className="underline hover:text-red-300">Add funds in your profile.</a>
                </div>
              )}
              {walletBalanceCents !== null && walletBalanceCents > 0 && Number(buyInInput) > walletBalanceCents && (
                <div className="mb-3 bg-yellow-950/40 border border-yellow-800 rounded-lg px-3 py-2 text-yellow-300 text-xs">
                  Insufficient balance. You have {fmt(walletBalanceCents)}.{' '}
                  <a href="/profile" className="underline hover:text-yellow-200">Add more funds.</a>
                </div>
              )}
              {walletCapped !== null && walletCapped >= min && (
                <button
                  onClick={() => setBuyInInput(String(walletCapped))}
                  className={`w-full mb-3 py-3 rounded-xl border-2 text-left px-4 transition-colors ${
                    buyInInput === String(walletCapped)
                      ? 'border-yellow-400 bg-yellow-900/30 text-white'
                      : 'border-gray-600 bg-gray-800/60 hover:border-gray-400 text-gray-200'
                  }`}
                >
                  <div className="text-xs text-gray-400 mb-0.5">All available</div>
                  <div className="font-bold text-lg">{fmt(walletCapped)}</div>
                  {(walletBalanceCents ?? 0) > max && (
                    <div className="text-xs text-gray-500">Capped at table max</div>
                  )}
                </button>
              )}

              {/* Custom amount */}
              <div className="mb-4">
                <label className="text-gray-400 text-xs mb-1 block">Custom amount</label>
                <input
                  className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white focus:border-yellow-400 focus:outline-none"
                  value={buyInInput}
                  onChange={(e) => setBuyInInput(e.target.value)}
                  type="number"
                  min={min}
                  max={max}
                />
                {config && (
                  <p className="text-gray-500 text-xs mt-1">
                    Range: {fmt(min)} – {fmt(max)}
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
                  disabled={
                    !buyInInput ||
                    Number(buyInInput) < min ||
                    (walletBalanceCents !== null && Number(buyInInput) > walletBalanceCents)
                  }
                  className="flex-1 py-2 rounded-lg bg-yellow-500 hover:bg-yellow-400 text-black font-bold disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Sit Down
                </button>
              </div>
            </div>
          </div>
        );
      })()}

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

      {/* Winner overlay — shown for ~5s after hand:complete */}
      {winnerData && (
        <WinnerOverlay
          winners={winnerData.winners}
          isFoldWin={winnerData.isFoldWin}
          durationMs={5000}
          onDismiss={dismissWinner}
          fmt={fmt}
        />
      )}

      {/* New hand banner — briefly shown when hand:started fires */}
      {newHandKey > 0 && (
        <NewHandBanner key={newHandKey} dealerName={newHandDealerName} />
      )}
    </div>
  );
}
