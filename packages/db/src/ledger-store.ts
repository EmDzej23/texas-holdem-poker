/**
 * PgLedgerStore — implements the engine's LedgerStore interface against Postgres.
 *
 * The interface contract (from packages/engine/src/ledger.ts):
 *   appendEntry(entry): Promise<void>
 *   findByIdempotencyKey(key): Promise<LedgerEntry | undefined>
 *   getEntriesForAccount(account): Promise<LedgerEntry[]>
 *   getAllEntries(): Promise<LedgerEntry[]>
 *
 * Idempotency guarantee: INSERT ... ON CONFLICT (idempotency_key) DO NOTHING
 * ensures a duplicate submission never produces a second row, even under
 * concurrent load. The UNIQUE constraint is the atomic safety net; the
 * application-level check in LedgerService.record() is an optimistic fast-path.
 *
 * Money mutations in LedgerService run inside SERIALIZABLE transactions when
 * called from a database-backed context — see hand-repo.ts for the pattern.
 */

import { eq, and, sql } from 'drizzle-orm';
import type { LedgerEntry, LedgerAccount } from '@poker/engine';
import type { LedgerStore } from '@poker/engine';
import { ledgerEntries } from './schema/ledger.js';
import type { Db } from './client.js';

export interface CurrencyBalance {
  currencySymbol: string;
  balanceCents: number;
}

/** Wallet balance per currency for a player. */
export async function getWalletBalancesByCurrency(db: Db, playerId: string): Promise<CurrencyBalance[]> {
  const [credits, debits] = await Promise.all([
    db
      .select({
        currencySymbol: ledgerEntries.currencySymbol,
        total: sql<string>`COALESCE(SUM(${ledgerEntries.amountMinor}), 0)`,
      })
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.creditOwner, playerId), eq(ledgerEntries.creditType, 'player_wallet')))
      .groupBy(ledgerEntries.currencySymbol),
    db
      .select({
        currencySymbol: ledgerEntries.currencySymbol,
        total: sql<string>`COALESCE(SUM(${ledgerEntries.amountMinor}), 0)`,
      })
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.debitOwner, playerId), eq(ledgerEntries.debitType, 'player_wallet')))
      .groupBy(ledgerEntries.currencySymbol),
  ]);

  const map = new Map<string, number>();
  for (const row of credits) {
    map.set(row.currencySymbol, (map.get(row.currencySymbol) ?? 0) + Number(row.total));
  }
  for (const row of debits) {
    map.set(row.currencySymbol, (map.get(row.currencySymbol) ?? 0) - Number(row.total));
  }

  return [...map.entries()]
    .map(([currencySymbol, balanceCents]) => ({ currencySymbol, balanceCents }))
    .filter((b) => b.balanceCents !== 0)
    .sort((a, b) => a.currencySymbol.localeCompare(b.currencySymbol));
}

function rowToEntry(row: typeof ledgerEntries.$inferSelect): LedgerEntry {
  return {
    id: row.id,
    idempotencyKey: row.idempotencyKey,
    timestamp: row.ts.getTime(),
    ...(row.handId !== null && { handId: row.handId }),
    description: row.description,
    debit: { type: row.debitType as LedgerAccount['type'], ownerId: row.debitOwner },
    credit: { type: row.creditType as LedgerAccount['type'], ownerId: row.creditOwner },
    amountCents: row.amountMinor,
    currencySymbol: row.currencySymbol,
  };
}

export function createPgLedgerStore(db: Db): LedgerStore {
  return {
    async appendEntry(entry: LedgerEntry): Promise<void> {
      await db
        .insert(ledgerEntries)
        .values({
          id: entry.id,
          idempotencyKey: entry.idempotencyKey,
          ts: new Date(entry.timestamp),
          handId: entry.handId ?? null,
          description: entry.description,
          debitOwner: entry.debit.ownerId,
          debitType: entry.debit.type,
          creditOwner: entry.credit.ownerId,
          creditType: entry.credit.type,
          amountMinor: entry.amountCents,
          currencySymbol: entry.currencySymbol,
        })
        .onConflictDoNothing({ target: ledgerEntries.idempotencyKey });
      // ON CONFLICT DO NOTHING: if another process won the race on the
      // same idempotency_key, we silently skip — the winner's row stands.
    },

    async findByIdempotencyKey(key: string): Promise<LedgerEntry | undefined> {
      const rows = await db
        .select()
        .from(ledgerEntries)
        .where(eq(ledgerEntries.idempotencyKey, key))
        .limit(1);
      return rows[0] ? rowToEntry(rows[0]) : undefined;
    },

    async getEntriesForAccount(account: LedgerAccount): Promise<LedgerEntry[]> {
      const { type, ownerId } = account;
      // Entries where this account is either the debit or credit side
      const [debits, credits] = await Promise.all([
        db
          .select()
          .from(ledgerEntries)
          .where(and(eq(ledgerEntries.debitOwner, ownerId), eq(ledgerEntries.debitType, type))),
        db
          .select()
          .from(ledgerEntries)
          .where(and(eq(ledgerEntries.creditOwner, ownerId), eq(ledgerEntries.creditType, type))),
      ]);
      // Deduplicate (a single entry could appear in both if debit == credit, which is invalid)
      const seen = new Set<string>();
      return [...debits, ...credits]
        .filter((r) => {
          if (seen.has(r.id)) return false;
          seen.add(r.id);
          return true;
        })
        .map(rowToEntry);
    },

    async getAllEntries(): Promise<LedgerEntry[]> {
      const rows = await db.select().from(ledgerEntries);
      return rows.map(rowToEntry);
    },
  };
}
