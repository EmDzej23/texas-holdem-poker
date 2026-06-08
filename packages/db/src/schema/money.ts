/**
 * Real-money ↔ token accounting.
 *
 * token_purchases: player requests tokens (status=pending), admin approves
 *   and posts the ledger credit (status=approved), or rejects (status=rejected).
 *   Tokens are NOT credited until admin explicitly approves.
 *
 * cashouts: player requests real-money withdrawal (status=pending) — tokens
 *   are immediately held via a ledger entry (hold_idempotency_key).
 *   Admin approves → tokens leave system (approve_idempotency_key posted).
 *   Admin rejects → tokens released back to wallet (approve_idempotency_key = release entry).
 *
 * TODO (production): KYC/AML gate, payment-provider webhook, real exchange rates.
 */
import { pgTable, text, bigint, timestamp, uuid, index, numeric } from 'drizzle-orm/pg-core';
import { players } from './players.js';
import { admins } from './admins.js';

export const tokenPurchases = pgTable(
  'token_purchases',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    playerId: text('player_id').notNull().references(() => players.id),
    /** Tokens requested (= real_money_minor at 1:1 for now) */
    tokenAmount: bigint('token_amount', { mode: 'number' }).notNull(),
    /** Real money owed in minor units (cents) — what player is due to pay */
    realMoneyMinor: bigint('real_money_minor', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('USD'),
    /** pending | approved | rejected | cancelled */
    status: text('status').notNull().default('pending'),
    /** Idempotency key used for the ledger credit on approval (prevents double-credit) */
    approveIdempotencyKey: text('approve_idempotency_key').notNull(),
    /** Admin who approved or rejected */
    actionedByAdminId: uuid('actioned_by_admin_id').references(() => admins.id),
    actionReason: text('action_reason'),
    actionedAt: timestamp('actioned_at', { withTimezone: true }),
    /** Optional: payment reference once real-money side settles (future use) */
    paymentRef: text('payment_ref'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('token_purchases_player_idx').on(t.playerId), index('token_purchases_status_idx').on(t.status)],
);

export const cashouts = pgTable(
  'cashouts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    playerId: text('player_id').notNull().references(() => players.id),
    /** Tokens to withdraw */
    tokenAmount: bigint('token_amount', { mode: 'number' }).notNull(),
    /** Real money to be paid out in minor units */
    realMoneyMinor: bigint('real_money_minor', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('USD'),
    /** pending | approved | rejected | cancelled */
    status: text('status').notNull().default('pending'),
    /**
     * Idempotency key for the hold ledger entry (wallet → cashout_hold).
     * Written at request time so tokens are immediately reserved.
     */
    holdIdempotencyKey: text('hold_idempotency_key').notNull(),
    /**
     * Idempotency key for the approve/reject ledger entry.
     * Approve: cashout_hold → house_rake.
     * Reject: cashout_hold → player_wallet.
     */
    settleIdempotencyKey: text('settle_idempotency_key').notNull(),
    /** Admin who approved or rejected */
    actionedByAdminId: uuid('actioned_by_admin_id').references(() => admins.id),
    actionReason: text('action_reason'),
    actionedAt: timestamp('actioned_at', { withTimezone: true }),
    /** Optional: payment reference once real-money side settles */
    paymentRef: text('payment_ref'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('cashouts_player_idx').on(t.playerId), index('cashouts_status_idx').on(t.status)],
);

export type TokenPurchaseRow = typeof tokenPurchases.$inferSelect;
export type CashoutRow = typeof cashouts.$inferSelect;
