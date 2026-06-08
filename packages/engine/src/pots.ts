import type { Cents, Pot } from './types.js';

export interface PotContribution {
  playerId: string;
  seatIndex: number;
  totalContributedCents: Cents;
  folded: boolean;
}

/**
 * Calculate side pots from per-player contributions.
 *
 * Algorithm (O(n log n)):
 *   For each unique contribution level L (ascending):
 *     - Each player contributes min(their_total, L) - previousLevel to this pot.
 *     - Eligible winners = players with total >= L AND not folded.
 *
 * Folded players' money goes into the pots they contributed to,
 * but they cannot win those pots.
 *
 * All-in players with contributions < others cap their own eligibility;
 * excess goes to higher pots without them.
 *
 * A player who is the ONLY eligible winner of a pot (e.g. excess over
 * everyone else's all-in) is awarded that pot immediately — it never
 * enters a showdown.
 */
export function calculatePots(contributions: PotContribution[]): Pot[] {
  // Ignore players who put in nothing
  const nonZero = contributions.filter((c) => c.totalContributedCents > 0);
  if (nonZero.length === 0) return [];

  // Collect unique contribution levels
  const levels = [
    ...new Set(nonZero.map((c) => c.totalContributedCents)),
  ].sort((a, b) => a - b);

  const pots: Pot[] = [];
  let previousLevel = 0;

  for (const level of levels) {
    const capPerPlayer = level - previousLevel;

    // Each contributor puts in min(their_remaining, capPerPlayer)
    let potAmount = 0;
    for (const c of nonZero) {
      potAmount += Math.min(
        Math.max(c.totalContributedCents - previousLevel, 0),
        capPerPlayer,
      );
    }

    // Eligible: contributed >= level AND didn't fold
    const eligiblePlayerIds = nonZero
      .filter((c) => c.totalContributedCents >= level && !c.folded)
      .map((c) => c.playerId);

    if (potAmount > 0) {
      pots.push({ amountCents: potAmount, eligiblePlayerIds });
    }

    previousLevel = level;
  }

  // Handle players who contributed MORE than the highest all-in level
  // (they put chips in but no-one is capped at their level — handled by
  //  the last iteration above since their contribution IS a unique level).
  // Nothing extra needed.

  return pots;
}

/**
 * Merge pots that share identical eligible player sets.
 * Reduces pot count when no real side pot is needed.
 */
export function mergePots(pots: Pot[]): Pot[] {
  const map = new Map<string, Pot>();
  for (const pot of pots) {
    const key = [...pot.eligiblePlayerIds].sort().join(',');
    const existing = map.get(key);
    if (existing) {
      existing.amountCents += pot.amountCents;
    } else {
      map.set(key, { ...pot, eligiblePlayerIds: [...pot.eligiblePlayerIds] });
    }
  }
  return [...map.values()];
}

/**
 * Split a pot amount evenly among winners.
 * Remainder (odd chips) stays in the pot for now — caller handles
 * allocation (e.g. award to player closest to dealer button).
 */
export function splitPot(
  amountCents: Cents,
  winnerCount: number,
): { perWinner: Cents; remainder: Cents } {
  if (winnerCount === 0) return { perWinner: 0, remainder: amountCents };
  const perWinner = Math.floor(amountCents / winnerCount);
  const remainder = amountCents - perWinner * winnerCount;
  return { perWinner, remainder };
}
