import { pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { authUsers } from './auth.js';

/**
 * Poker profile for each authenticated player.
 * id = better-auth user.id — created via databaseHook on user signup.
 */
export const players = pgTable(
  'players',
  {
    id: text('id')
      .primaryKey()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    username: text('username').notNull(),
    email: text('email'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('players_username_idx').on(t.username)],
);

export type PlayerRow = typeof players.$inferSelect;
export type NewPlayerRow = typeof players.$inferInsert;
