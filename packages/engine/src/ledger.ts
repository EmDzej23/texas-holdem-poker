/**
 * Double-entry ledger for chip movements.
 *
 * Every chip movement is a balanced transaction:
 *   debit one account / credit another, amountCents always positive.
 *
 * Source of truth for balances. Table stacks are a projection reconciled
 * on sit-down and cash-out.
 *
 * Idempotency: transactions keyed by idempotencyKey; duplicate submissions
 * with the same key are rejected with the original result returned.
 */

import { randomUUID } from 'node:crypto';
import type {
  Cents,
  LedgerAccount,
  LedgerEntry,
  LedgerQueryResult,
  LedgerTransactionType,
} from './types.js';

// ---------------------------------------------------------------------------
// In-memory ledger store (swap for DB-backed impl in production)
// ---------------------------------------------------------------------------

export interface LedgerStore {
  appendEntry(entry: LedgerEntry): Promise<void>;
  findByIdempotencyKey(key: string): Promise<LedgerEntry | undefined>;
  getEntriesForAccount(account: LedgerAccount): Promise<LedgerEntry[]>;
  getAllEntries(): Promise<LedgerEntry[]>;
}

export function createInMemoryLedgerStore(): LedgerStore {
  const entries: LedgerEntry[] = [];
  const byIdempotencyKey = new Map<string, LedgerEntry>();

  function accountKey(a: LedgerAccount): string {
    return `${a.type}:${a.ownerId}`;
  }

  return {
    async appendEntry(entry: LedgerEntry): Promise<void> {
      entries.push(entry);
      byIdempotencyKey.set(entry.idempotencyKey, entry);
    },

    async findByIdempotencyKey(key: string): Promise<LedgerEntry | undefined> {
      return byIdempotencyKey.get(key);
    },

    async getEntriesForAccount(account: LedgerAccount): Promise<LedgerEntry[]> {
      const key = accountKey(account);
      return entries.filter(
        (e) => accountKey(e.debit) === key || accountKey(e.credit) === key,
      );
    },

    async getAllEntries(): Promise<LedgerEntry[]> {
      return [...entries];
    },
  };
}

// ---------------------------------------------------------------------------
// Ledger service
// ---------------------------------------------------------------------------

export interface TransactionInput {
  idempotencyKey: string;
  description: string;
  debit: LedgerAccount;
  credit: LedgerAccount;
  amountCents: Cents;
  handId?: string | undefined;
  currencySymbol?: string | undefined; // defaults to '$' when not set
}

export interface TransactionResult {
  entry: LedgerEntry;
  isDuplicate: boolean;
}

export class LedgerService {
  constructor(private readonly store: LedgerStore) {}

  /**
   * Record a double-entry transaction.
   * Idempotent: if idempotencyKey was already used, returns the original entry.
   */
  async record(input: TransactionInput): Promise<TransactionResult> {
    if (input.amountCents <= 0) {
      throw new Error(`LedgerService: amountCents must be positive, got ${input.amountCents}`);
    }
    if (!Number.isInteger(input.amountCents)) {
      throw new Error(`LedgerService: amountCents must be an integer, got ${input.amountCents}`);
    }

    const existing = await this.store.findByIdempotencyKey(input.idempotencyKey);
    if (existing) {
      return { entry: existing, isDuplicate: true };
    }

    const entry: LedgerEntry = {
      id: randomUUID(),
      idempotencyKey: input.idempotencyKey,
      timestamp: Date.now(),
      ...(input.handId !== undefined && { handId: input.handId }),
      description: input.description,
      debit: input.debit,
      credit: input.credit,
      amountCents: input.amountCents,
      currencySymbol: input.currencySymbol ?? '$',
    };

    await this.store.appendEntry(entry);
    return { entry, isDuplicate: false };
  }

  /**
   * Get the balance of an account.
   * Credits increase balance; debits decrease balance.
   * (Normal balance: credit = player wallet, player stack = positive balance)
   */
  async getBalance(account: LedgerAccount): Promise<Cents> {
    const entries = await this.store.getEntriesForAccount(account);
    const accountKey = (a: LedgerAccount) => `${a.type}:${a.ownerId}`;
    const key = accountKey(account);

    let balance = 0;
    for (const entry of entries) {
      if (accountKey(entry.credit) === key) balance += entry.amountCents;
      if (accountKey(entry.debit) === key) balance -= entry.amountCents;
    }
    return balance;
  }

  async query(account: LedgerAccount): Promise<LedgerQueryResult> {
    const entries = await this.store.getEntriesForAccount(account);
    const balance = await this.getBalance(account);
    return { account, balanceCents: balance, entries };
  }

  /**
   * Buy-in: move chips from player wallet to their table stack.
   * TODO (production): wrap in a DB transaction for atomicity.
   */
  async buyIn(
    playerId: string,
    tableId: string,
    amountCents: Cents,
    idempotencyKey: string,
  ): Promise<TransactionResult> {
    const currentBalance = await this.getBalance({ type: 'player_wallet', ownerId: playerId });
    if (currentBalance < amountCents) {
      throw new Error(
        `Insufficient funds: player ${playerId} has ${currentBalance} cents, needs ${amountCents}`,
      );
    }

    return this.record({
      idempotencyKey,
      description: `Buy-in: player ${playerId} at table ${tableId}`,
      debit: { type: 'player_wallet', ownerId: playerId },
      credit: { type: 'player_table_stack', ownerId: `${playerId}:${tableId}` },
      amountCents,
    });
  }

  /**
   * Cash-out: move chips from table stack back to player wallet.
   */
  async cashOut(
    playerId: string,
    tableId: string,
    amountCents: Cents,
    idempotencyKey: string,
  ): Promise<TransactionResult> {
    if (amountCents <= 0) return {
      entry: null as unknown as LedgerEntry,
      isDuplicate: false,
    };

    return this.record({
      idempotencyKey,
      description: `Cash-out: player ${playerId} from table ${tableId}`,
      debit: { type: 'player_table_stack', ownerId: `${playerId}:${tableId}` },
      credit: { type: 'player_wallet', ownerId: playerId },
      amountCents,
    });
  }

  /** Record chips moved from player stack to pot (blind, bet). */
  async bet(
    playerId: string,
    tableId: string,
    amountCents: Cents,
    idempotencyKey: string,
    handId?: string,
    description = 'Bet',
  ): Promise<TransactionResult> {
    return this.record({
      idempotencyKey,
      description: `${description}: player ${playerId} table ${tableId}`,
      debit: { type: 'player_table_stack', ownerId: `${playerId}:${tableId}` },
      credit: { type: 'table_pot', ownerId: tableId },
      amountCents,
      handId,
    });
  }

  /** Record pot winnings awarded to a player. */
  async win(
    playerId: string,
    tableId: string,
    amountCents: Cents,
    idempotencyKey: string,
    handId?: string,
  ): Promise<TransactionResult> {
    return this.record({
      idempotencyKey,
      description: `Win: player ${playerId} table ${tableId}`,
      debit: { type: 'table_pot', ownerId: tableId },
      credit: { type: 'player_table_stack', ownerId: `${playerId}:${tableId}` },
      amountCents,
      handId,
    });
  }

  /** Record rake collected to house. */
  async rake(
    tableId: string,
    amountCents: Cents,
    idempotencyKey: string,
    handId?: string,
  ): Promise<TransactionResult> {
    return this.record({
      idempotencyKey,
      description: `Rake: table ${tableId}`,
      debit: { type: 'table_pot', ownerId: tableId },
      credit: { type: 'house_rake', ownerId: 'house' },
      amountCents,
      handId,
    });
  }

  /**
   * Move tokens from player wallet to the escrow/hold account when they
   * request a real-money cash-out. Tokens are unavailable while held.
   * On approve → settleHold(). On reject → releaseHold().
   */
  async holdForCashout(
    playerId: string,
    amountCents: Cents,
    idempotencyKey: string,
  ): Promise<TransactionResult> {
    return this.record({
      idempotencyKey,
      description: `Cashout hold: player ${playerId}`,
      debit: { type: 'player_wallet', ownerId: playerId },
      credit: { type: 'player_cashout_hold', ownerId: playerId },
      amountCents,
    });
  }

  /**
   * Admin approves cashout: escrow → house (tokens leave system, real money due).
   */
  async settleHold(
    playerId: string,
    amountCents: Cents,
    idempotencyKey: string,
  ): Promise<TransactionResult> {
    return this.record({
      idempotencyKey,
      description: `Cashout settled: player ${playerId}`,
      debit: { type: 'player_cashout_hold', ownerId: playerId },
      credit: { type: 'house_rake', ownerId: 'house' },
      amountCents,
    });
  }

  /**
   * Admin rejects cashout: escrow → wallet (tokens released back to player).
   */
  async releaseHold(
    playerId: string,
    amountCents: Cents,
    idempotencyKey: string,
  ): Promise<TransactionResult> {
    return this.record({
      idempotencyKey,
      description: `Cashout released: player ${playerId}`,
      debit: { type: 'player_cashout_hold', ownerId: playerId },
      credit: { type: 'player_wallet', ownerId: playerId },
      amountCents,
    });
  }

  /**
   * Deposit chips into a player's wallet (admin / deposit flow).
   * TODO (production): integrate with payment processor; this is a seam.
   */
  async deposit(
    playerId: string,
    amountCents: Cents,
    idempotencyKey: string,
  ): Promise<TransactionResult> {
    return this.record({
      idempotencyKey,
      description: `Deposit: player ${playerId}`,
      debit: { type: 'house_rake', ownerId: 'house' }, // placeholder; real impl: payment ledger
      credit: { type: 'player_wallet', ownerId: playerId },
      amountCents,
    });
  }
}

// ---------------------------------------------------------------------------
// Convenience factory
// ---------------------------------------------------------------------------

export function createLedger(store?: LedgerStore): LedgerService {
  return new LedgerService(store ?? createInMemoryLedgerStore());
}
