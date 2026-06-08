/**
 * Reconciliation test suite.
 *
 * Proves that after any sequence of ledger operations the system is
 * self-consistent:
 *
 *   1. LEDGER SUM CHECK: by construction, each LedgerEntry carries the same
 *      amount on the debit and credit side — so the sum of all amounts equals
 *      both total debits and total credits (trivially zero net).
 *
 *   2. ECONOMIC BALANCE (drift = 0):
 *        deposited = outstanding + held + rake + cashedOut + activePot
 *      Where:
 *        deposited   = approved purchases (debit=house_rake → credit=player_wallet)
 *        outstanding = player_wallet + player_table_stack net balances
 *        held        = player_cashout_hold net balance (pending cashout escrow)
 *        rake        = debit=table_pot → credit=house_rake
 *        cashedOut   = debit=player_cashout_hold → credit=house_rake (settled)
 *        activePot   = table_pot net (should be 0 between hands)
 *
 *   3. IDEMPOTENCY: replaying any transaction returns the original entry
 *      without altering any balance.
 *
 * All tests run against the in-memory LedgerStore — no database required.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createInMemoryLedgerStore, LedgerService, createLedger } from '@poker/engine';
import type { LedgerStore, LedgerEntry } from '@poker/engine';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function totalByType(
  entries: LedgerEntry[],
  side: 'debit' | 'credit',
  type: string,
): number {
  return entries
    .filter((e) => e[side].type === type)
    .reduce((s, e) => s + e.amountCents, 0);
}

interface DriftReport {
  drift: number;
  deposited: number;
  cashedOut: number;
  outstanding: number;
  held: number;
  rake: number;
  activePot: number;
}

/**
 * Compute drift from a set of in-memory ledger entries.
 *   drift = deposited − outstanding − held − rake − cashedOut − activePot
 * Must be 0 for a well-formed ledger.
 */
function computeDrift(entries: LedgerEntry[]): DriftReport {
  // Approved purchases: debit=house_rake → credit=player_wallet
  const deposited = entries
    .filter((e) => e.debit.type === 'house_rake' && e.credit.type === 'player_wallet')
    .reduce((s, e) => s + e.amountCents, 0);

  // Settled cashouts: debit=player_cashout_hold → credit=house_rake
  const cashedOut = entries
    .filter((e) => e.debit.type === 'player_cashout_hold' && e.credit.type === 'house_rake')
    .reduce((s, e) => s + e.amountCents, 0);

  // Outstanding = player_wallet net + player_table_stack net
  const walletNet =
    totalByType(entries, 'credit', 'player_wallet') -
    totalByType(entries, 'debit', 'player_wallet');
  const stackNet =
    totalByType(entries, 'credit', 'player_table_stack') -
    totalByType(entries, 'debit', 'player_table_stack');
  const outstanding = walletNet + stackNet;

  // Held = player_cashout_hold net (tokens in escrow pending cashout)
  const held =
    totalByType(entries, 'credit', 'player_cashout_hold') -
    totalByType(entries, 'debit', 'player_cashout_hold');

  // Rake: debit=table_pot → credit=house_rake
  const rake = entries
    .filter((e) => e.debit.type === 'table_pot' && e.credit.type === 'house_rake')
    .reduce((s, e) => s + e.amountCents, 0);

  // Active pot = table_pot net (credits − debits)
  const activePot =
    totalByType(entries, 'credit', 'table_pot') -
    totalByType(entries, 'debit', 'table_pot');

  const drift = deposited - outstanding - held - rake - cashedOut - activePot;
  return { drift, deposited, cashedOut, outstanding, held, rake, activePot };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Reconciliation — economic balance', () => {
  let store: LedgerStore;
  let ledger: LedgerService;

  beforeEach(() => {
    store = createInMemoryLedgerStore();
    ledger = createLedger(store);
  });

  it('empty ledger has zero drift', async () => {
    const { drift } = computeDrift(await store.getAllEntries());
    expect(drift).toBe(0);
  });

  it('deposit then buy-in: drift = 0', async () => {
    await ledger.deposit('alice', 10000, 'dep-alice');
    await ledger.buyIn('alice', 'table-1', 5000, 'buyin-alice');
    const { drift } = computeDrift(await store.getAllEntries());
    expect(drift).toBe(0);
  });

  it('full hand: deposit → buy-in → bet → win → rake → drift = 0', async () => {
    await ledger.deposit('alice', 10000, 'dep-alice');
    await ledger.deposit('bob',   10000, 'dep-bob');
    await ledger.buyIn('alice', 't1', 5000, 'buyin-alice');
    await ledger.buyIn('bob',   't1', 5000, 'buyin-bob');

    await ledger.bet('alice', 't1', 50,  'sb-alice', 'h1', 'Blind');
    await ledger.bet('bob',   't1', 100, 'bb-bob',   'h1', 'Blind');
    await ledger.bet('alice', 't1', 200, 'bet-alice', 'h1');
    await ledger.bet('bob',   't1', 200, 'bet-bob',   'h1');

    // Total pot = 50+100+200+200 = 550; rake 50, winner gets 500
    await ledger.win('alice', 't1', 500, 'win-alice', 'h1');
    await ledger.rake('t1', 50, 'rake-h1', 'h1');

    const { drift, activePot } = computeDrift(await store.getAllEntries());
    expect(activePot).toBe(0);
    expect(drift).toBe(0);
  });

  it('multiple hands: drift = 0 after each hand', async () => {
    for (const p of ['alice', 'bob', 'carol']) {
      await ledger.deposit(p, 50000, `dep-${p}`);
      await ledger.buyIn(p, 't1', 20000, `buyin-${p}`);
    }

    for (let h = 0; h < 3; h++) {
      const handId = `hand-${h}`;
      await ledger.bet('alice', 't1', 50,  `sb-${h}`,   handId, 'Blind');
      await ledger.bet('bob',   't1', 100, `bb-${h}`,   handId, 'Blind');
      await ledger.bet('carol', 't1', 100, `call-${h}`, handId);
      // Total pot = 250; rake 15, winner gets 235
      await ledger.win('bob', 't1', 235, `win-${h}`, handId);
      await ledger.rake('t1', 15, `rake-${h}`, handId);

      const { drift, activePot } = computeDrift(await store.getAllEntries());
      expect(activePot).toBe(0);
      expect(drift).toBe(0);
    }
  });

  it('all-in side pot: drift = 0', async () => {
    await ledger.deposit('short', 5000,  'dep-short');
    await ledger.deposit('deep',  50000, 'dep-deep');
    await ledger.buyIn('short', 't1', 500,   'buyin-short');
    await ledger.buyIn('deep',  't1', 20000, 'buyin-deep');

    const handId = 'allin-hand';
    await ledger.bet('short', 't1', 500, 'allin-short', handId);
    await ledger.bet('deep',  't1', 500, 'allin-deep',  handId);
    // Total pot = 1000; rake 10, winner gets 990
    await ledger.win('deep', 't1', 990, 'win-deep', handId);
    await ledger.rake('t1', 10, 'rake-allin', handId);

    const { drift, activePot } = computeDrift(await store.getAllEntries());
    expect(activePot).toBe(0);
    expect(drift).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Cashout hold flow
  // -------------------------------------------------------------------------

  it('cashout request: tokens held, drift = 0', async () => {
    await ledger.deposit('alice', 10000, 'dep-1');

    // Alice holds 3000 for cashout
    await ledger.holdForCashout('alice', 3000, 'hold-1');

    const entries = await store.getAllEntries();
    const { drift, outstanding, held } = computeDrift(entries);
    expect(outstanding).toBe(7000);  // 10000 - 3000 held
    expect(held).toBe(3000);
    expect(drift).toBe(0);
  });

  it('cashout approved: held tokens leave system, drift = 0', async () => {
    await ledger.deposit('alice', 10000, 'dep-1');
    await ledger.holdForCashout('alice', 3000, 'hold-1');
    await ledger.settleHold('alice', 3000, 'settle-1');

    const { drift, held, cashedOut } = computeDrift(await store.getAllEntries());
    expect(held).toBe(0);
    expect(cashedOut).toBe(3000);
    expect(drift).toBe(0);
  });

  it('cashout rejected: held tokens returned to wallet, drift = 0', async () => {
    await ledger.deposit('alice', 10000, 'dep-1');
    await ledger.holdForCashout('alice', 3000, 'hold-1');
    await ledger.releaseHold('alice', 3000, 'release-1');

    const { drift, held, outstanding } = computeDrift(await store.getAllEntries());
    expect(held).toBe(0);
    expect(outstanding).toBe(10000); // all tokens back
    expect(drift).toBe(0);
  });

  it('pending purchase creates no balance (tokens not credited until approve)', async () => {
    // A pending purchase has NO ledger entry — only the DB row exists.
    // After approval, deposit() is called which creates the entry.
    // Simulate: no ledger entries yet (pending state)
    const { drift, outstanding, deposited } = computeDrift(await store.getAllEntries());
    expect(deposited).toBe(0);
    expect(outstanding).toBe(0);
    expect(drift).toBe(0);

    // Simulate approval: deposit() called
    await ledger.deposit('bob', 5000, 'approve-purchase-1');
    const after = computeDrift(await store.getAllEntries());
    expect(after.deposited).toBe(5000);
    expect(after.outstanding).toBe(5000);
    expect(after.drift).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Idempotency
  // -------------------------------------------------------------------------

  it('replaying deposit does not alter balance', async () => {
    await ledger.deposit('alice', 10000, 'idem-dep');
    const bal1 = await ledger.getBalance({ type: 'player_wallet', ownerId: 'alice' });

    const r2 = await ledger.deposit('alice', 99999, 'idem-dep');
    expect(r2.isDuplicate).toBe(true);

    const bal2 = await ledger.getBalance({ type: 'player_wallet', ownerId: 'alice' });
    expect(bal1).toBe(bal2);
    expect(bal1).toBe(10000);
  });

  it('replaying hold does not double-debit wallet', async () => {
    await ledger.deposit('alice', 10000, 'dep-1');
    await ledger.holdForCashout('alice', 5000, 'hold-1');

    const r2 = await ledger.holdForCashout('alice', 5000, 'hold-1'); // duplicate
    expect(r2.isDuplicate).toBe(true);

    const wallet = await ledger.getBalance({ type: 'player_wallet', ownerId: 'alice' });
    const held = await ledger.getBalance({ type: 'player_cashout_hold', ownerId: 'alice' });
    expect(wallet).toBe(5000);
    expect(held).toBe(5000);
    expect(computeDrift(await store.getAllEntries()).drift).toBe(0);
  });

  it('replaying buy-in does not double-debit wallet', async () => {
    await ledger.deposit('alice', 10000, 'dep-1');
    await ledger.buyIn('alice', 't1', 5000, 'buyin-1');
    const r2 = await ledger.buyIn('alice', 't1', 5000, 'buyin-1');
    expect(r2.isDuplicate).toBe(true);

    const wallet = await ledger.getBalance({ type: 'player_wallet', ownerId: 'alice' });
    const stack  = await ledger.getBalance({ type: 'player_table_stack', ownerId: 'alice:t1' });
    expect(wallet).toBe(5000);
    expect(stack).toBe(5000);
  });

  // -------------------------------------------------------------------------
  // No fractional cents
  // -------------------------------------------------------------------------

  it('rejects fractional amounts', async () => {
    await expect(
      ledger.record({
        idempotencyKey: 'frac',
        description: 'Bad',
        debit: { type: 'player_wallet', ownerId: 'p' },
        credit: { type: 'house_rake', ownerId: 'house' },
        amountCents: 0.5,
      }),
    ).rejects.toThrow();
  });
});
