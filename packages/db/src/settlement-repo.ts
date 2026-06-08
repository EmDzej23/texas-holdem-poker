/**
 * SettlementRepository — admin-side approval/rejection of pending money movements.
 *
 * LEDGER TIMING (critical correctness):
 *
 * Token purchase (pending buy-in):
 *   Request  → no ledger entry (player owes real money, tokens NOT credited)
 *   Approve  → debit house_rake → credit player_wallet (tokens credited, idempotent)
 *   Reject   → no ledger entry, status closed
 *
 * Cash-out (pending withdrawal):
 *   Request  → debit player_wallet → credit player_cashout_hold (tokens held immediately)
 *   Approve  → debit player_cashout_hold → credit house_rake (tokens leave system)
 *   Reject   → debit player_cashout_hold → credit player_wallet (tokens released)
 *
 * Every status transition is one-way and guarded (must be 'pending' to approve/reject).
 * Approving/rejecting twice is safe: the ledger entry is idempotent, and the DB
 * guard on status prevents the transition from running again.
 */

import { eq, and, or, desc, asc } from 'drizzle-orm';
import type { Db } from './client.js';
import { tokenPurchases, cashouts } from './schema/money.js';
import { LedgerService } from '@poker/engine';
import type { TokenPurchaseRow, CashoutRow } from './schema/money.js';

export interface PendingSettlement {
  type: 'purchase' | 'cashout';
  id: string;
  playerId: string;
  tokenAmount: number;
  realMoneyMinor: number;
  currency: string;
  status: string;
  createdAt: Date;
}

export interface SettlementRepository {
  /** Player creates a token-purchase request (no ledger entry yet). */
  createPurchaseRequest(input: {
    playerId: string;
    tokenAmount: number;
  }): Promise<string>; // returns purchase id

  /** Player requests cash-out; tokens immediately held via ledger. */
  requestCashout(input: {
    playerId: string;
    tokenAmount: number;
    ledger: LedgerService;
  }): Promise<string>; // returns cashout id

  /** Admin approves a pending purchase: credits tokens to player wallet. */
  approvePurchase(input: {
    purchaseId: string;
    adminId: string;
    reason?: string;
    ledger: LedgerService;
  }): Promise<void>;

  /** Admin rejects a pending purchase: no ledger movement. */
  rejectPurchase(input: {
    purchaseId: string;
    adminId: string;
    reason: string;
  }): Promise<void>;

  /** Admin approves a cash-out: held tokens leave the system. */
  approveCashout(input: {
    cashoutId: string;
    adminId: string;
    reason?: string;
    paymentRef?: string;
    ledger: LedgerService;
  }): Promise<void>;

  /** Admin rejects a cash-out: held tokens released back to wallet. */
  rejectCashout(input: {
    cashoutId: string;
    adminId: string;
    reason: string;
    ledger: LedgerService;
  }): Promise<void>;

  /** List all pending (and optionally historical) settlements across all players. */
  listSettlements(opts?: {
    status?: string;
    type?: 'purchase' | 'cashout';
    playerId?: string;
    limit?: number;
    offset?: number;
  }): Promise<PendingSettlement[]>;

  getPurchase(id: string): Promise<TokenPurchaseRow | undefined>;
  getCashout(id: string): Promise<CashoutRow | undefined>;
  getPurchasesForPlayer(playerId: string): Promise<TokenPurchaseRow[]>;
  getCashoutsForPlayer(playerId: string): Promise<CashoutRow[]>;
}

export function createSettlementRepository(db: Db): SettlementRepository {
  return {
    async createPurchaseRequest({ playerId, tokenAmount }) {
      const approveIdempotencyKey = `purchase-approve-${crypto.randomUUID()}`;
      const rows = await db
        .insert(tokenPurchases)
        .values({
          playerId,
          tokenAmount,
          realMoneyMinor: tokenAmount, // 1 token = 1 cent
          currency: 'USD',
          status: 'pending',
          approveIdempotencyKey,
        })
        .returning({ id: tokenPurchases.id });
      return rows[0]!.id;
    },

    async requestCashout({ playerId, tokenAmount, ledger }) {
      const holdIdempotencyKey = `cashout-hold-${crypto.randomUUID()}`;
      const settleIdempotencyKey = `cashout-settle-${crypto.randomUUID()}`;

      // Hold tokens immediately before inserting the cashout row so they
      // can't be spent. If the ledger entry fails, nothing is inserted.
      await ledger.holdForCashout(playerId, tokenAmount, holdIdempotencyKey);

      const rows = await db
        .insert(cashouts)
        .values({
          playerId,
          tokenAmount,
          realMoneyMinor: tokenAmount, // 1 token = 1 cent
          currency: 'USD',
          status: 'pending',
          holdIdempotencyKey,
          settleIdempotencyKey,
        })
        .returning({ id: cashouts.id });
      return rows[0]!.id;
    },

    async approvePurchase({ purchaseId, adminId, reason, ledger }) {
      const rows = await db
        .select()
        .from(tokenPurchases)
        .where(and(eq(tokenPurchases.id, purchaseId), eq(tokenPurchases.status, 'pending')))
        .limit(1);

      const purchase = rows[0];
      if (!purchase) throw new Error(`Purchase ${purchaseId} not found or not pending`);

      // Credit tokens to player wallet
      await ledger.deposit(purchase.playerId, purchase.tokenAmount, purchase.approveIdempotencyKey);

      await db
        .update(tokenPurchases)
        .set({
          status: 'approved',
          actionedByAdminId: adminId,
          actionReason: reason ?? null,
          actionedAt: new Date(),
        })
        .where(eq(tokenPurchases.id, purchaseId));
    },

    async rejectPurchase({ purchaseId, adminId, reason }) {
      const updated = await db
        .update(tokenPurchases)
        .set({
          status: 'rejected',
          actionedByAdminId: adminId,
          actionReason: reason,
          actionedAt: new Date(),
        })
        .where(and(eq(tokenPurchases.id, purchaseId), eq(tokenPurchases.status, 'pending')))
        .returning({ id: tokenPurchases.id });

      if (updated.length === 0) throw new Error(`Purchase ${purchaseId} not found or not pending`);
    },

    async approveCashout({ cashoutId, adminId, reason, paymentRef, ledger }) {
      const rows = await db
        .select()
        .from(cashouts)
        .where(and(eq(cashouts.id, cashoutId), eq(cashouts.status, 'pending')))
        .limit(1);

      const cashout = rows[0];
      if (!cashout) throw new Error(`Cashout ${cashoutId} not found or not pending`);

      // Tokens leave system: held → house_rake
      await ledger.settleHold(cashout.playerId, cashout.tokenAmount, cashout.settleIdempotencyKey);

      await db
        .update(cashouts)
        .set({
          status: 'approved',
          actionedByAdminId: adminId,
          actionReason: reason ?? null,
          actionedAt: new Date(),
          paymentRef: paymentRef ?? null,
        })
        .where(eq(cashouts.id, cashoutId));
    },

    async rejectCashout({ cashoutId, adminId, reason, ledger }) {
      const rows = await db
        .select()
        .from(cashouts)
        .where(and(eq(cashouts.id, cashoutId), eq(cashouts.status, 'pending')))
        .limit(1);

      const cashout = rows[0];
      if (!cashout) throw new Error(`Cashout ${cashoutId} not found or not pending`);

      // Release tokens back to wallet: held → player_wallet
      await ledger.releaseHold(cashout.playerId, cashout.tokenAmount, cashout.settleIdempotencyKey);

      await db
        .update(cashouts)
        .set({
          status: 'rejected',
          actionedByAdminId: adminId,
          actionReason: reason,
          actionedAt: new Date(),
        })
        .where(eq(cashouts.id, cashoutId));
    },

    async listSettlements({ status, type, playerId, limit = 50, offset = 0 } = {}) {
      const results: PendingSettlement[] = [];

      if (!type || type === 'purchase') {
        const purchaseRows = await db
          .select()
          .from(tokenPurchases)
          .where(
            and(
              status ? eq(tokenPurchases.status, status) : undefined,
              playerId ? eq(tokenPurchases.playerId, playerId) : undefined,
            ),
          )
          .orderBy(desc(tokenPurchases.createdAt))
          .limit(limit)
          .offset(offset);

        for (const r of purchaseRows) {
          results.push({
            type: 'purchase',
            id: r.id,
            playerId: r.playerId,
            tokenAmount: r.tokenAmount,
            realMoneyMinor: r.realMoneyMinor,
            currency: r.currency,
            status: r.status,
            createdAt: r.createdAt,
          });
        }
      }

      if (!type || type === 'cashout') {
        const cashoutRows = await db
          .select()
          .from(cashouts)
          .where(
            and(
              status ? eq(cashouts.status, status) : undefined,
              playerId ? eq(cashouts.playerId, playerId) : undefined,
            ),
          )
          .orderBy(desc(cashouts.createdAt))
          .limit(limit)
          .offset(offset);

        for (const r of cashoutRows) {
          results.push({
            type: 'cashout',
            id: r.id,
            playerId: r.playerId,
            tokenAmount: r.tokenAmount,
            realMoneyMinor: r.realMoneyMinor,
            currency: r.currency,
            status: r.status,
            createdAt: r.createdAt,
          });
        }
      }

      results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return results;
    },

    async getPurchase(id) {
      const rows = await db.select().from(tokenPurchases).where(eq(tokenPurchases.id, id)).limit(1);
      return rows[0];
    },

    async getCashout(id) {
      const rows = await db.select().from(cashouts).where(eq(cashouts.id, id)).limit(1);
      return rows[0];
    },

    async getPurchasesForPlayer(playerId) {
      return db
        .select()
        .from(tokenPurchases)
        .where(eq(tokenPurchases.playerId, playerId))
        .orderBy(desc(tokenPurchases.createdAt));
    },

    async getCashoutsForPlayer(playerId) {
      return db
        .select()
        .from(cashouts)
        .where(eq(cashouts.playerId, playerId))
        .orderBy(desc(cashouts.createdAt));
    },
  };
}
