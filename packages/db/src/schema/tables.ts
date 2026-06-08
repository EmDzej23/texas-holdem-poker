/**
 * table_records — ephemeral live-state snapshot, implementing TableStore.
 * Contents: the in-flight HandState and seat array serialised to JSON.
 * Postgres is the durable backing for this snapshot so the process can
 * restart and rebuild in-memory state from here.
 *
 * sessions — per-seat buy-in/cash-out record (audit trail).
 */
import { pgTable, text, integer, bigint, timestamp, uuid, index } from 'drizzle-orm/pg-core';
import { players } from './players.js';

export const tableRecords = pgTable('table_records', {
  tableId: text('table_id').primaryKey(),
  handStateJson: text('hand_state_json'),
  seatsJson: text('seats_json').notNull().default('[]'),
  shuffleIndex: integer('shuffle_index').notNull().default(0),
  configJson: text('config_json').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).defaultNow().notNull(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    playerId: text('player_id').notNull().references(() => players.id),
    tableId: text('table_id').notNull(),
    seatIndex: integer('seat_index').notNull(),
    buyInMinor: bigint('buy_in_minor', { mode: 'number' }).notNull(),
    stackMinor: bigint('stack_minor', { mode: 'number' }).notNull().default(0),
    joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
    leftAt: timestamp('left_at', { withTimezone: true }),
  },
  (t) => [
    index('sessions_player_idx').on(t.playerId),
    index('sessions_table_idx').on(t.tableId),
  ],
);

export type TableRecordRow = typeof tableRecords.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
