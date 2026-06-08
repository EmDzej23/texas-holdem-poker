/**
 * Hand evaluator — wraps pokersolver behind a stable internal interface.
 * pokersolver uses format: '2c', 'Kh', 'As', etc. (rank + lowercase suit)
 * Our Card type uses the same format, so no conversion needed.
 */
import { createRequire } from 'node:module';
import type { Card } from './types.js';

const require = createRequire(import.meta.url);
// pokersolver is a legacy CJS module with named exports
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Hand } = require('pokersolver') as {
  Hand: {
    solve: (cards: string[]) => PokerHand;
    winners: (hands: PokerHand[]) => PokerHand[];
  };
};

interface PokerHand {
  name: string;
  descr: string;
  cards: Array<{ value: string; suit: string }>;
  rank: number;
  cardPool: Array<{ value: string; suit: string }>;
  toString: () => string;
}

export interface EvaluatedHand {
  rank: number;           // lower = better (pokersolver convention, 1 = royal flush)
  name: string;           // e.g. "Flush"
  description: string;    // e.g. "Ace High Flush"
  bestCards: Card[];      // the 5 cards making the best hand
  _raw: PokerHand;
}

export function evaluateHand(holeCards: [Card, Card], communityCards: Card[]): EvaluatedHand {
  const allCards = [...holeCards, ...communityCards];
  if (allCards.length < 5 || allCards.length > 7) {
    throw new Error(`evaluateHand: need 5-7 cards, got ${allCards.length}`);
  }
  const hand = Hand.solve(allCards);
  const bestCards = hand.cards.map(
    (c) => `${c.value === 'T' ? 'T' : c.value}${c.suit}` as Card,
  );
  return {
    rank: hand.rank,
    name: hand.name,
    description: hand.descr,
    bestCards,
    _raw: hand,
  };
}

export interface ShowdownHand {
  playerId: string;
  seatIndex: number;
  holeCards: [Card, Card];
  evaluated: EvaluatedHand;
}

/**
 * Given evaluated hands for all showdown contestants, return the winner
 * groups (ties are grouped together). Each group is a set of tied winners.
 * The first group wins; subsequent groups are losers.
 */
export function findWinners(hands: ShowdownHand[]): ShowdownHand[][] {
  if (hands.length === 0) return [];
  if (hands.length === 1) return [hands];

  const rawHands = hands.map((h) => h.evaluated._raw);
  const rawWinners = Hand.winners(rawHands);

  // pokersolver winners() returns the winning raw hands; find matching ShowdownHands
  const winnerSet = new Set(rawWinners);
  const winners = hands.filter((h) => winnerSet.has(h.evaluated._raw));
  const losers = hands.filter((h) => !winnerSet.has(h.evaluated._raw));

  if (losers.length === 0) return [winners];

  // Recursively rank the remaining losers
  return [winners, ...findWinners(losers)];
}
