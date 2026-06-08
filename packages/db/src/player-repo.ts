/**
 * PlayerRepository — identity records and poker session tracking.
 *
 * Balances are NEVER stored here — always derived from the ledger.
 * Money movements (token purchases, cashouts) are in settlement-repo.ts.
 */

import { eq, and } from 'drizzle-orm';
import type { Db } from './client.js';
import { players, sessions } from './schema/index.js';

export interface PlayerRepository {
  upsertPlayer(id: string, username: string, email?: string): Promise<void>;
  getPlayer(id: string): Promise<typeof players.$inferSelect | undefined>;
  listPlayers(): Promise<typeof players.$inferSelect[]>;

  openSession(input: {
    playerId: string;
    tableId: string;
    seatIndex: number;
    buyInMinor: number;
  }): Promise<string>;

  closeSession(sessionId: string, finalStackMinor: number): Promise<void>;
}

export function createPlayerRepository(db: Db): PlayerRepository {
  return {
    async upsertPlayer(id, username, email) {
      await db
        .insert(players)
        .values({ id, username, email: email ?? null })
        .onConflictDoUpdate({
          target: players.id,
          set: { username },
        });
    },

    async getPlayer(id) {
      const rows = await db.select().from(players).where(eq(players.id, id)).limit(1);
      return rows[0];
    },

    async listPlayers() {
      return db.select().from(players).orderBy(players.createdAt);
    },

    async openSession({ playerId, tableId, seatIndex, buyInMinor }) {
      const rows = await db
        .insert(sessions)
        .values({ playerId, tableId, seatIndex, buyInMinor, stackMinor: buyInMinor })
        .returning({ id: sessions.id });
      return rows[0]!.id;
    },

    async closeSession(sessionId, finalStackMinor) {
      await db
        .update(sessions)
        .set({ stackMinor: finalStackMinor, leftAt: new Date() })
        .where(eq(sessions.id, sessionId));
    },
  };
}
