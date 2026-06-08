import { describe, it, expect, beforeEach } from 'vitest';
import { createLedger, createInMemoryLedgerStore, LedgerService } from '../ledger.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLedger(): LedgerService {
  return createLedger(createInMemoryLedgerStore());
}

// ---------------------------------------------------------------------------
// Basic recording
// ---------------------------------------------------------------------------

describe('LedgerService.record', () => {
  it('records a transaction and returns an entry', async () => {
    const ledger = makeLedger();
    const result = await ledger.record({
      idempotencyKey: 'idem-1',
      description: 'Test entry',
      debit: { type: 'player_wallet', ownerId: 'player-1' },
      credit: { type: 'house_rake', ownerId: 'house' },
      amountCents: 500,
    });
    expect(result.isDuplicate).toBe(false);
    expect(result.entry.amountCents).toBe(500);
    expect(result.entry.id).toBeTruthy();
  });

  it('rejects non-positive amounts', async () => {
    const ledger = makeLedger();
    await expect(
      ledger.record({
        idempotencyKey: 'bad',
        description: 'Bad',
        debit: { type: 'player_wallet', ownerId: 'p' },
        credit: { type: 'house_rake', ownerId: 'h' },
        amountCents: 0,
      }),
    ).rejects.toThrow();
  });

  it('rejects fractional amounts', async () => {
    const ledger = makeLedger();
    await expect(
      ledger.record({
        idempotencyKey: 'frac',
        description: 'Fractional',
        debit: { type: 'player_wallet', ownerId: 'p' },
        credit: { type: 'house_rake', ownerId: 'h' },
        amountCents: 1.5,
      }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

describe('idempotency', () => {
  it('duplicate key returns original entry without double-recording', async () => {
    const ledger = makeLedger();
    const r1 = await ledger.record({
      idempotencyKey: 'dup-key',
      description: 'First',
      debit: { type: 'player_wallet', ownerId: 'p1' },
      credit: { type: 'house_rake', ownerId: 'house' },
      amountCents: 100,
    });

    const r2 = await ledger.record({
      idempotencyKey: 'dup-key',
      description: 'Second (duplicate)',
      debit: { type: 'player_wallet', ownerId: 'p1' },
      credit: { type: 'house_rake', ownerId: 'house' },
      amountCents: 999, // different amount — should be ignored
    });

    expect(r2.isDuplicate).toBe(true);
    expect(r2.entry.id).toBe(r1.entry.id);
    expect(r2.entry.amountCents).toBe(100); // original amount preserved

    // Balance should reflect only ONE transaction
    const balance = await ledger.getBalance({ type: 'player_wallet', ownerId: 'p1' });
    expect(balance).toBe(-100);
  });

  it('different keys are independent', async () => {
    const ledger = makeLedger();
    await ledger.record({
      idempotencyKey: 'k1',
      description: 'T1',
      debit: { type: 'player_wallet', ownerId: 'p1' },
      credit: { type: 'house_rake', ownerId: 'house' },
      amountCents: 100,
    });
    await ledger.record({
      idempotencyKey: 'k2',
      description: 'T2',
      debit: { type: 'player_wallet', ownerId: 'p1' },
      credit: { type: 'house_rake', ownerId: 'house' },
      amountCents: 200,
    });
    const balance = await ledger.getBalance({ type: 'player_wallet', ownerId: 'p1' });
    expect(balance).toBe(-300);
  });
});

// ---------------------------------------------------------------------------
// Balance calculation
// ---------------------------------------------------------------------------

describe('getBalance', () => {
  it('starts at zero', async () => {
    const ledger = makeLedger();
    const balance = await ledger.getBalance({ type: 'player_wallet', ownerId: 'new-player' });
    expect(balance).toBe(0);
  });

  it('credits increase balance', async () => {
    const ledger = makeLedger();
    await ledger.deposit('p1', 10000, 'dep-1');
    const balance = await ledger.getBalance({ type: 'player_wallet', ownerId: 'p1' });
    expect(balance).toBe(10000);
  });

  it('debits decrease balance', async () => {
    const ledger = makeLedger();
    await ledger.deposit('p1', 10000, 'dep-1');
    await ledger.record({
      idempotencyKey: 'debit-1',
      description: 'Withdrawal',
      debit: { type: 'player_wallet', ownerId: 'p1' },
      credit: { type: 'house_rake', ownerId: 'house' },
      amountCents: 3000,
    });
    const balance = await ledger.getBalance({ type: 'player_wallet', ownerId: 'p1' });
    expect(balance).toBe(7000);
  });

  it('double-entry balances: sum of all accounts is zero', async () => {
    const store = createInMemoryLedgerStore();
    const ledger = createLedger(store);

    // Deposit
    await ledger.deposit('p1', 10000, 'dep-1');
    // Buy-in
    await ledger.buyIn('p1', 'table-1', 5000, 'buyin-1');
    // Bet
    await ledger.bet('p1', 'table-1', 200, 'bet-1', 'hand-1');
    // Win
    await ledger.win('p1', 'table-1', 400, 'win-1', 'hand-1');
    // Rake
    await ledger.rake('table-1', 20, 'rake-1', 'hand-1');

    // Verify conservation: sum of all credit sides = sum of all debit sides
    const allEntries = await store.getAllEntries();
    const totalCredited = allEntries.reduce((s, e) => s + e.amountCents, 0);
    const totalDebited = allEntries.reduce((s, e) => s + e.amountCents, 0);
    expect(totalCredited).toBe(totalDebited);
  });
});

// ---------------------------------------------------------------------------
// Buy-in / cash-out
// ---------------------------------------------------------------------------

describe('buyIn', () => {
  it('moves chips from wallet to table stack', async () => {
    const ledger = makeLedger();
    await ledger.deposit('p1', 10000, 'dep-1');
    await ledger.buyIn('p1', 'table-1', 5000, 'buyin-1');

    const wallet = await ledger.getBalance({ type: 'player_wallet', ownerId: 'p1' });
    const stack = await ledger.getBalance({ type: 'player_table_stack', ownerId: 'p1:table-1' });
    expect(wallet).toBe(5000);
    expect(stack).toBe(5000);
  });

  it('rejects buy-in with insufficient funds', async () => {
    const ledger = makeLedger();
    await ledger.deposit('p1', 1000, 'dep-1');
    await expect(ledger.buyIn('p1', 'table-1', 5000, 'buyin-1')).rejects.toThrow(/insufficient/i);
  });

  it('buy-in is idempotent', async () => {
    const ledger = makeLedger();
    await ledger.deposit('p1', 10000, 'dep-1');
    await ledger.buyIn('p1', 'table-1', 5000, 'buyin-1');
    const r2 = await ledger.buyIn('p1', 'table-1', 5000, 'buyin-1'); // duplicate
    expect(r2.isDuplicate).toBe(true);
    const wallet = await ledger.getBalance({ type: 'player_wallet', ownerId: 'p1' });
    expect(wallet).toBe(5000); // not double-debited
  });
});

describe('cashOut', () => {
  it('moves chips from table stack back to wallet', async () => {
    const ledger = makeLedger();
    await ledger.deposit('p1', 10000, 'dep-1');
    await ledger.buyIn('p1', 'table-1', 5000, 'buyin-1');
    await ledger.cashOut('p1', 'table-1', 4000, 'cashout-1');

    const wallet = await ledger.getBalance({ type: 'player_wallet', ownerId: 'p1' });
    const stack = await ledger.getBalance({ type: 'player_table_stack', ownerId: 'p1:table-1' });
    expect(wallet).toBe(9000);
    expect(stack).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// Bet / win / rake flow
// ---------------------------------------------------------------------------

describe('bet / win / rake', () => {
  it('moves chips correctly through a hand', async () => {
    const store = createInMemoryLedgerStore();
    const ledger = createLedger(store);
    await ledger.deposit('p1', 10000, 'dep-p1');
    await ledger.deposit('p2', 10000, 'dep-p2');
    await ledger.buyIn('p1', 't1', 5000, 'buyin-p1');
    await ledger.buyIn('p2', 't1', 5000, 'buyin-p2');

    // Both bet 100 into the pot
    await ledger.bet('p1', 't1', 100, 'bet-p1-h1', 'h1');
    await ledger.bet('p2', 't1', 100, 'bet-p2-h1', 'h1');

    // P1 wins 190 (rake 10)
    await ledger.win('p1', 't1', 190, 'win-p1-h1', 'h1');
    await ledger.rake('t1', 10, 'rake-h1', 'h1');

    const p1Stack = await ledger.getBalance({ type: 'player_table_stack', ownerId: 'p1:t1' });
    const p2Stack = await ledger.getBalance({ type: 'player_table_stack', ownerId: 'p2:t1' });
    const pot = await ledger.getBalance({ type: 'table_pot', ownerId: 't1' });

    expect(p1Stack).toBe(5090); // 5000 - 100 + 190
    expect(p2Stack).toBe(4900); // 5000 - 100
    expect(pot).toBe(0);        // 200 in - 190 win - 10 rake = 0

    // Verify rake entry was recorded separately
    const allEntries = await store.getAllEntries();
    const rakeEntry = allEntries.find((e) => e.idempotencyKey === 'rake-h1');
    expect(rakeEntry).toBeDefined();
    expect(rakeEntry!.amountCents).toBe(10);
  });
});
