/**
 * HandRepository — writes completed hands to the append-only audit log.
 *
 * Called by the WS service after the engine emits hand:complete.
 * Never called by the engine itself — the engine is pure.
 *
 * All writes are a single DB transaction: hands row + hand_actions + hand_results.
 * If the transaction fails the ws-service logs a warning; live play continues.
 * A retry (same handId) will hit the hand PK constraint and be a no-op.
 */

import type { HandState, GameEvent } from '@poker/engine';
import { hands, handActions, handResults } from './schema/hands.js';
import type { Db } from './client.js';
import { eq } from 'drizzle-orm';

export interface HandRepository {
  /** Record a fully completed hand (engine phase = 'complete'). Idempotent on handId. */
  recordCompletedHand(state: HandState, events: GameEvent[], tableId: string): Promise<void>;
  getHandById(handId: string): Promise<typeof hands.$inferSelect | undefined>;
  getHandActions(handId: string): Promise<typeof handActions.$inferSelect[]>;
  getHandResults(handId: string): Promise<typeof handResults.$inferSelect[]>;
  listHandsForTable(tableId: string, limit?: number): Promise<typeof hands.$inferSelect[]>;
}

export function createHandRepository(db: Db): HandRepository {
  return {
    async recordCompletedHand(state: HandState, events: GameEvent[], tableId: string): Promise<void> {
      // Already recorded? PK conflict will abort — safe to re-throw or swallow.
      const existingRows = await db
        .select({ id: hands.id })
        .from(hands)
        .where(eq(hands.id, state.handId))
        .limit(1);
      if (existingRows.length > 0) return; // idempotent

      const awardedEvents = events.filter(
        (e): e is Extract<GameEvent, { type: 'pot:awarded' }> => e.type === 'pot:awarded',
      );
      const showdownEvent = events.find(
        (e): e is Extract<GameEvent, { type: 'showdown' }> => e.type === 'showdown',
      );
      const completeEvent = events.find(
        (e): e is Extract<GameEvent, { type: 'hand:complete' }> => e.type === 'hand:complete',
      );

      const totalPot = awardedEvents.reduce((s, e) => s + e.amountCents, 0);

      // Build per-player result rows from engine state
      type ResultAccum = {
        playerId: string;
        seatIndex: number;
        contributedMinor: number;
        wonMinor: number;
        holeCards?: string;
        handRank?: string;
      };

      const resultMap = new Map<string, ResultAccum>();

      // Compute per-player contributions from action history (totalHandContributionCents
      // is reset to 0 in finishHand before this method is called).
      const contributionByPlayer = new Map<string, number>();
      for (const action of state.actionHistory) {
        if (action.amountCents > 0) {
          contributionByPlayer.set(
            action.playerId,
            (contributionByPlayer.get(action.playerId) ?? 0) + action.amountCents,
          );
        }
      }

      for (const seat of state.seats) {
        if (!seat.playerId) continue;
        resultMap.set(seat.playerId, {
          playerId: seat.playerId,
          seatIndex: seat.seatIndex,
          contributedMinor: contributionByPlayer.get(seat.playerId) ?? 0,
          wonMinor: 0,
        });
      }

      for (const award of awardedEvents) {
        for (const winner of award.winners) {
          const acc = resultMap.get(winner.playerId);
          if (acc) acc.wonMinor += winner.amountCents;
        }
      }

      if (showdownEvent) {
        for (const result of showdownEvent.results) {
          const acc = resultMap.get(result.playerId);
          if (acc) {
            acc.holeCards = JSON.stringify(result.holeCards);
            acc.handRank = result.handRank;
          }
        }
      }

      const resultRows = [...resultMap.values()].map((r) => ({
        handId: state.handId,
        playerId: r.playerId,
        seatIndex: r.seatIndex,
        holeCardsJson: r.holeCards ?? null,
        handRank: r.handRank ?? null,
        contributedMinor: r.contributedMinor,
        wonMinor: r.wonMinor,
        netMinor: r.wonMinor - r.contributedMinor,
      }));

      // Build action rows from the engine's action history
      const actionRows = state.actionHistory.map((a, seq) => ({
        handId: state.handId,
        playerId: a.playerId,
        seatIndex: a.seatIndex,
        street: a.phase,
        action: a.type,
        amountMinor: a.amountCents,
        seq,
        createdAt: new Date(a.timestamp),
      }));

      await db.transaction(async (tx) => {
        await tx.insert(hands).values({
          id: state.handId,
          tableId,
          dealerSeat: state.dealerSeatIndex,
          sbSeat: state.smallBlindSeatIndex,
          bbSeat: state.bigBlindSeatIndex,
          potTotalMinor: totalPot + state.rakeCollectedCents,
          rakeMinor: state.rakeCollectedCents,
          rngCommit: state.commitment.serverSeedHash,
          rngReveal: completeEvent?.seedReveal ?? state.commitment.serverSeed ?? null,
          rngClientSeed: state.commitment.clientSeed,
          rngShuffleIndex: state.commitment.shuffleIndex,
          boardJson: JSON.stringify(state.communityCards),
          phase: state.phase,
          endedAt: new Date(),
        });

        if (actionRows.length > 0) {
          await tx.insert(handActions).values(actionRows);
        }
        if (resultRows.length > 0) {
          await tx.insert(handResults).values(resultRows);
        }
      });
    },

    async getHandById(handId: string) {
      const rows = await db
        .select()
        .from(hands)
        .where(eq(hands.id, handId))
        .limit(1);
      return rows[0];
    },

    async getHandActions(handId: string) {
      return db
        .select()
        .from(handActions)
        .where(eq(handActions.handId, handId))
        .orderBy(handActions.seq);
    },

    async getHandResults(handId: string) {
      return db
        .select()
        .from(handResults)
        .where(eq(handResults.handId, handId));
    },

    async listHandsForTable(tableId: string, limit = 50) {
      return db
        .select()
        .from(hands)
        .where(eq(hands.tableId, tableId))
        .orderBy(hands.startedAt)
        .limit(limit);
    },
  };
}
