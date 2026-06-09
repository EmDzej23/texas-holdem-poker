'use client';

import { useState, useCallback, useEffect } from 'react';
import type { ValidAction } from '@poker/engine';

interface BetControlsProps {
  validActions: ValidAction[];
  potCents: number;
  stackCents: number;
  currentBetCents: number;
  myBetCents: number;
  bigBlindCents: number;
  onFold: () => void;
  onCheck: () => void;
  onCall: () => void;
  onBet: (amountCents: number) => void;
  onRaise: (amountCents: number) => void;
  onAllIn: () => void;
  fmt: (cents: number) => string;
}

export function BetControls({
  validActions,
  potCents,
  stackCents,
  currentBetCents,
  myBetCents,
  bigBlindCents,
  onFold,
  onCheck,
  onCall,
  onBet,
  onRaise,
  onAllIn,
  fmt,
}: BetControlsProps) {
  const betAction = validActions.find((a) => a.type === 'bet');
  const raiseAction = validActions.find((a) => a.type === 'raise');
  const callAction = validActions.find((a) => a.type === 'call');
  const canCheck = validActions.some((a) => a.type === 'check');
  const canFold = validActions.some((a) => a.type === 'fold');
  const canAllIn = validActions.some((a) => a.type === 'allIn');

  const betOrRaise = betAction ?? raiseAction;
  const minBet = Math.max(betOrRaise?.minCents ?? bigBlindCents, bigBlindCents || 1);
  const maxBet = Math.max(betOrRaise?.maxCents ?? stackCents, minBet);

  const [sliderValue, setSliderValue] = useState<number>(() => minBet);
  // Reset slider to minimum whenever the betting context changes (new turn)
  useEffect(() => { setSliderValue(minBet); }, [minBet]);

  const effectiveSlider = Math.max(minBet, Math.min(sliderValue, maxBet));
  const callAmount = callAction?.minCents ?? 0;

  // Pot-sized raise shortcuts
  const potRaise = Math.min(potCents + 2 * (currentBetCents - myBetCents), maxBet);
  const halfPotRaise = Math.min(Math.floor(potCents / 2) + (currentBetCents - myBetCents), maxBet);

  const handleBetOrRaise = useCallback(() => {
    if (betAction) onBet(effectiveSlider);
    else if (raiseAction) onRaise(effectiveSlider);
  }, [betAction, raiseAction, effectiveSlider, onBet, onRaise]);

  if (validActions.length === 0) return null;

  return (
    <div className="fixed bottom-0 sm:bottom-4 left-0 right-0 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 w-full sm:max-w-lg sm:px-4 animate-slide-up z-40">
      <div className="bg-gray-900/98 border border-gray-600 sm:rounded-2xl rounded-t-2xl p-3 sm:p-4 shadow-2xl backdrop-blur pb-safe">
        {/* Sizing row */}
        {betOrRaise && (
          <div className="mb-2 sm:mb-3">
            <div className="flex justify-between text-gray-400 text-xs mb-1">
              <span>{fmt(minBet)}</span>
              <span className="text-white font-bold">{fmt(effectiveSlider)}</span>
              <span>{fmt(maxBet)}</span>
            </div>
            <input
              type="range"
              min={minBet}
              max={maxBet}
              step={bigBlindCents}
              value={effectiveSlider}
              onChange={(e) => setSliderValue(Number(e.target.value))}
              className="w-full accent-yellow-400 h-6"
            />
            {/* Quick-size buttons */}
            <div className="flex gap-1.5 sm:gap-2 mt-1.5 sm:mt-2">
              {halfPotRaise >= minBet && halfPotRaise <= maxBet && (
                <button
                  onClick={() => setSliderValue(halfPotRaise)}
                  className="flex-1 text-xs py-1 rounded bg-gray-700 text-gray-200 hover:bg-gray-600 active:bg-gray-500"
                >
                  ½ Pot
                </button>
              )}
              {potRaise >= minBet && potRaise <= maxBet && (
                <button
                  onClick={() => setSliderValue(potRaise)}
                  className="flex-1 text-xs py-1 rounded bg-gray-700 text-gray-200 hover:bg-gray-600 active:bg-gray-500"
                >
                  Pot
                </button>
              )}
              <button
                onClick={() => setSliderValue(maxBet)}
                className="flex-1 text-xs py-1 rounded bg-gray-700 text-gray-200 hover:bg-gray-600 active:bg-gray-500"
              >
                Max
              </button>
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-1.5 sm:gap-2">
          {canFold && (
            <button
              onClick={onFold}
              className="flex-1 py-3 sm:py-3 rounded-xl bg-red-700 hover:bg-red-600 active:bg-red-500 text-white font-bold text-xs sm:text-sm transition-colors"
            >
              Fold
            </button>
          )}
          {canCheck && (
            <button
              onClick={onCheck}
              className="flex-1 py-3 rounded-xl bg-blue-700 hover:bg-blue-600 active:bg-blue-500 text-white font-bold text-xs sm:text-sm transition-colors"
            >
              Check
            </button>
          )}
          {callAction && (
            <button
              onClick={onCall}
              className="flex-1 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 active:bg-blue-400 text-white font-bold text-xs sm:text-sm transition-colors"
            >
              Call {fmt(callAmount)}
            </button>
          )}
          {betOrRaise && (
            <button
              onClick={handleBetOrRaise}
              className="flex-1 py-3 rounded-xl bg-yellow-500 hover:bg-yellow-400 active:bg-yellow-300 text-black font-bold text-xs sm:text-sm transition-colors"
            >
              {betAction ? 'Bet' : 'Raise'} {fmt(effectiveSlider)}
            </button>
          )}
          {canAllIn && (
            <button
              onClick={onAllIn}
              className="flex-1 py-3 rounded-xl bg-orange-600 hover:bg-orange-500 active:bg-orange-400 text-white font-bold text-xs sm:text-sm transition-colors"
            >
              All-In {fmt(stackCents)}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
