import { pgTable, text, bigint, timestamp, uuid, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * ledger_entries — the double-entry source of truth.
 *
 * Maps 1:1 to the engine's LedgerEntry interface:
 *   debit_owner + debit_type  → LedgerAccount (debit side)
 *   credit_owner + credit_type → LedgerAccount (credit side)
 *
 * idempotency_key has a UNIQUE constraint so concurrent duplicate inserts
 * are rejected at the DB level (ON CONFLICT DO NOTHING).
 *
 * amount_minor is always > 0 — direction is determined by debit/credit columns.
 */
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    idempotencyKey: text('idempotency_key').notNull(),
    ts: timestamp('ts', { withTimezone: true }).defaultNow().notNull(),
    handId: text('hand_id'),
    description: text('description').notNull(),
    debitOwner: text('debit_owner').notNull(),
    debitType: text('debit_type').notNull(),
    creditOwner: text('credit_owner').notNull(),
    creditType: text('credit_type').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
  },
  (t) => [
    uniqueIndex('ledger_entries_idempotency_key_idx').on(t.idempotencyKey),
    index('ledger_entries_debit_idx').on(t.debitOwner, t.debitType),
    index('ledger_entries_credit_idx').on(t.creditOwner, t.creditType),
    index('ledger_entries_hand_idx').on(t.handId),
    check('ledger_entries_amount_positive', sql`${t.amountMinor} > 0`),
  ],
);

export type LedgerEntryRow = typeof ledgerEntries.$inferSelect;
export type NewLedgerEntryRow = typeof ledgerEntries.$inferInsert;
