import { describe, it, expect } from 'vitest';
import { calculatePots, mergePots, splitPot } from '../pots.js';
import type { PotContribution } from '../pots.js';

function contrib(
  playerId: string,
  totalContributedCents: number,
  folded = false,
  seatIndex = 0,
): PotContribution {
  return { playerId, seatIndex, totalContributedCents, folded };
}

// ---------------------------------------------------------------------------
// Basic cases
// ---------------------------------------------------------------------------
describe('calculatePots — basic', () => {
  it('single player returns one pot', () => {
    const pots = calculatePots([contrib('A', 100)]);
    expect(pots).toHaveLength(1);
    expect(pots[0]!.amountCents).toBe(100);
    expect(pots[0]!.eligiblePlayerIds).toEqual(['A']);
  });

  it('two equal players, no folds — one pot', () => {
    const pots = calculatePots([contrib('A', 100), contrib('B', 100)]);
    expect(pots).toHaveLength(1);
    expect(pots[0]!.amountCents).toBe(200);
    expect(pots[0]!.eligiblePlayerIds).toContain('A');
    expect(pots[0]!.eligiblePlayerIds).toContain('B');
  });

  it('returns empty array for zero contributions', () => {
    expect(calculatePots([])).toHaveLength(0);
    expect(calculatePots([contrib('A', 0)])).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Side pot correctness
// ---------------------------------------------------------------------------
describe('calculatePots — side pots', () => {
  it('two players, one all-in for less', () => {
    // A is all-in for 50, B has 100 in. Main pot = 100, B gets 50 back.
    // Wait — B can only win what A put in too.
    // Main pot: 50+50=100, eligible [A,B]
    // Side pot: 50 (B only), eligible [B]
    const pots = calculatePots([contrib('A', 50), contrib('B', 100)]);
    expect(pots).toHaveLength(2);
    const main = pots[0]!;
    const side = pots[1]!;
    expect(main.amountCents).toBe(100);
    expect(main.eligiblePlayerIds).toContain('A');
    expect(main.eligiblePlayerIds).toContain('B');
    expect(side.amountCents).toBe(50);
    expect(side.eligiblePlayerIds).toEqual(['B']);
    expect(side.eligiblePlayerIds).not.toContain('A');
  });

  it('three players with different all-in amounts', () => {
    // C(25), B(50), A(100) all in
    const pots = calculatePots([
      contrib('A', 100),
      contrib('B', 50),
      contrib('C', 25),
    ]);
    expect(pots).toHaveLength(3);

    // Pot 0: 25*3=75, eligible A,B,C
    expect(pots[0]!.amountCents).toBe(75);
    expect(pots[0]!.eligiblePlayerIds.sort()).toEqual(['A', 'B', 'C']);

    // Pot 1: 25*2=50, eligible A,B
    expect(pots[1]!.amountCents).toBe(50);
    expect(pots[1]!.eligiblePlayerIds.sort()).toEqual(['A', 'B']);

    // Pot 2: 50*1=50, eligible A only
    expect(pots[2]!.amountCents).toBe(50);
    expect(pots[2]!.eligiblePlayerIds).toEqual(['A']);

    // Total should equal sum of contributions
    const total = pots.reduce((s, p) => s + p.amountCents, 0);
    expect(total).toBe(175);
  });

  it('four players — canonical side-pot example', () => {
    // A=100, B=50, C=25, D=200
    const pots = calculatePots([
      contrib('A', 100),
      contrib('B', 50),
      contrib('C', 25),
      contrib('D', 200),
    ]);

    const total = pots.reduce((s, p) => s + p.amountCents, 0);
    expect(total).toBe(375); // 100+50+25+200

    // Pot at level 25: 25*4=100, eligible A,B,C,D
    expect(pots[0]!.amountCents).toBe(100);
    expect(pots[0]!.eligiblePlayerIds.sort()).toEqual(['A', 'B', 'C', 'D']);

    // Pot at level 50: 25*3=75, eligible A,B,D
    expect(pots[1]!.amountCents).toBe(75);
    expect(pots[1]!.eligiblePlayerIds.sort()).toEqual(['A', 'B', 'D']);

    // Pot at level 100: 50*2=100, eligible A,D
    expect(pots[2]!.amountCents).toBe(100);
    expect(pots[2]!.eligiblePlayerIds.sort()).toEqual(['A', 'D']);

    // Pot at level 200: 100*1=100, eligible D only
    expect(pots[3]!.amountCents).toBe(100);
    expect(pots[3]!.eligiblePlayerIds).toEqual(['D']);
  });

  it('folded player contributes to pot but cannot win', () => {
    // B folded after putting in 50. A put in 100.
    // Main pot: 50+50=100, eligible A only (B folded)
    // Side pot: 50, eligible A only
    const pots = calculatePots([contrib('A', 100), contrib('B', 50, true /* folded */)]);

    const total = pots.reduce((s, p) => s + p.amountCents, 0);
    expect(total).toBe(150);

    for (const pot of pots) {
      expect(pot.eligiblePlayerIds).not.toContain('B');
      expect(pot.eligiblePlayerIds).toContain('A');
    }
  });

  it('folded player in multi-player pot', () => {
    // A=100, B=100, C=50 folded
    const pots = calculatePots([
      contrib('A', 100),
      contrib('B', 100),
      contrib('C', 50, true),
    ]);

    const total = pots.reduce((s, p) => s + p.amountCents, 0);
    expect(total).toBe(250);

    // Level 50 pot: 50*3=150, eligible A,B (C folded)
    expect(pots[0]!.amountCents).toBe(150);
    expect(pots[0]!.eligiblePlayerIds.sort()).toEqual(['A', 'B']);

    // Level 100 pot: 50*2=100, eligible A,B
    expect(pots[1]!.amountCents).toBe(100);
    expect(pots[1]!.eligiblePlayerIds.sort()).toEqual(['A', 'B']);
  });

  it('preserves total chips (conservation)', () => {
    // Randomized conservation test
    const players = [
      contrib('A', 312),
      contrib('B', 180),
      contrib('C', 75),
      contrib('D', 400),
      contrib('E', 75, true),
    ];
    const inputTotal = players.reduce((s, p) => s + p.totalContributedCents, 0);
    const pots = calculatePots(players);
    const outputTotal = pots.reduce((s, p) => s + p.amountCents, 0);
    expect(outputTotal).toBe(inputTotal);
  });
});

// ---------------------------------------------------------------------------
// mergePots
// ---------------------------------------------------------------------------
describe('mergePots', () => {
  it('merges pots with identical eligible sets', () => {
    const pots = [
      { amountCents: 100, eligiblePlayerIds: ['A', 'B'] },
      { amountCents: 200, eligiblePlayerIds: ['B', 'A'] },
    ];
    const merged = mergePots(pots);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.amountCents).toBe(300);
  });

  it('keeps distinct eligible sets separate', () => {
    const pots = [
      { amountCents: 100, eligiblePlayerIds: ['A', 'B'] },
      { amountCents: 50, eligiblePlayerIds: ['A'] },
    ];
    const merged = mergePots(pots);
    expect(merged).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// splitPot
// ---------------------------------------------------------------------------
describe('splitPot', () => {
  it('splits evenly with no remainder', () => {
    const { perWinner, remainder } = splitPot(100, 2);
    expect(perWinner).toBe(50);
    expect(remainder).toBe(0);
  });

  it('handles odd chips', () => {
    const { perWinner, remainder } = splitPot(100, 3);
    expect(perWinner).toBe(33);
    expect(remainder).toBe(1);
    expect(perWinner * 3 + remainder).toBe(100);
  });

  it('handles single winner', () => {
    const { perWinner, remainder } = splitPot(150, 1);
    expect(perWinner).toBe(150);
    expect(remainder).toBe(0);
  });

  it('handles zero winners', () => {
    const { perWinner, remainder } = splitPot(100, 0);
    expect(perWinner).toBe(0);
    expect(remainder).toBe(100);
  });

  it('conserves total chips', () => {
    for (const n of [1, 2, 3, 4, 5]) {
      const amount = 101;
      const { perWinner, remainder } = splitPot(amount, n);
      expect(perWinner * n + remainder).toBe(amount);
    }
  });
});
