/**
 * Append-only hand history — written once when a hand completes, never updated.
 * rng_commit is published before dealing; rng_reveal is written on hand:complete.
 */
import { pgTable, text, integer, bigint, timestamp, uuid, index } from 'drizzle-orm/pg-core';
import { players } from './players.js';

export const hands = pgTable(
  'hands',
  {
    id: text('id').primaryKey(),
    tableId: text('table_id').notNull(),
    dealerSeat: integer('dealer_seat').notNull(),
    sbSeat: integer('sb_seat').notNull(),
    bbSeat: integer('bb_seat').notNull(),
    potTotalMinor: bigint('pot_total_minor', { mode: 'number' }).notNull().default(0),
    rakeMinor: bigint('rake_minor', { mode: 'number' }).notNull().default(0),
    rngCommit: text('rng_commit').notNull(),
    rngReveal: text('rng_reveal'),
    rngClientSeed: text('rng_client_seed').notNull(),
    rngShuffleIndex: integer('rng_shuffle_index').notNull(),
    boardJson: text('board_json'),
    phase: text('phase').notNull().default('preflop'),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (t) => [
    index('hands_table_idx').on(t.tableId),
    index('hands_started_idx').on(t.startedAt),
  ],
);

export const handActions = pgTable(
  'hand_actions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    handId: text('hand_id').notNull().references(() => hands.id),
    playerId: text('player_id').notNull(),
    seatIndex: integer('seat_index').notNull(),
    /** preflop | flop | turn | river */
    street: text('street').notNull(),
    /** fold | check | call | bet | raise | allIn | blind | timeout */
    action: text('action').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull().default(0),
    seq: integer('seq').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('hand_actions_hand_idx').on(t.handId, t.seq)],
);

export const handResults = pgTable(
  'hand_results',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    handId: text('hand_id').notNull().references(() => hands.id),
    playerId: text('player_id').notNull().references(() => players.id),
    seatIndex: integer('seat_index').notNull(),
    holeCardsJson: text('hole_cards_json'),
    handRank: text('hand_rank'),
    contributedMinor: bigint('contributed_minor', { mode: 'number' }).notNull().default(0),
    wonMinor: bigint('won_minor', { mode: 'number' }).notNull().default(0),
    netMinor: bigint('net_minor', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('hand_results_hand_idx').on(t.handId),
    index('hand_results_player_idx').on(t.playerId),
  ],
);

export type HandRow = typeof hands.$inferSelect;
export type HandActionRow = typeof handActions.$inferSelect;
export type HandResultRow = typeof handResults.$inferSelect;
