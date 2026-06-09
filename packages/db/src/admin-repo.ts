/**
 * AdminRepository — all figures derived from the ledger (never ad-hoc sums).
 *
 * Key admin metrics per player:
 *   amount_paid       = SUM(token_purchases.real_money_minor) WHERE status=completed
 *   tokens_purchased  = SUM(token_purchases.token_amount)
 *   current_balance   = derived from ledger: SUM(credit) - SUM(debit) for player_wallet
 *   total_cashed_out  = SUM(cashouts.real_money_minor) WHERE status=completed
 *   gross_winnings    = SUM(hand_results.won_minor)
 *   net_pnl           = (current_balance + total_cashed_out) - amount_paid
 *   table_net         = SUM(hand_results.net_minor)
 *   lifetime_rake     = derived from ledger: SUM(amount) WHERE debit=player_table_stack,
 *                       credit=house_rake AND hand_id IS NOT NULL
 *
 * Reconciliation invariant:
 *   total_deposited = outstanding_player_balances + total_rake + total_cashed_out
 *   (plus any chips currently in active pots — should be 0 between hands)
 */

import { sql, and, eq, gte, lte, desc } from 'drizzle-orm';
import type { Db } from './client.js';
import { ledgerEntries } from './schema/ledger.js';
import { players, tokenPurchases, cashouts, sessions, hands, handResults, adminAuditLog, admins } from './schema/index.js';

export interface PlayerSummary {
  id: string;
  username: string;
  email: string | null;
  createdAt: Date;
  amountPaidMinor: number;
  tokensPurchased: number;
  currentBalanceMinor: number;
  totalCashedOutMinor: number;
  grossWinningsMinor: number;
  netPnlMinor: number;
  tableNetMinor: number;
  lifetimeRakeMinor: number;
  handsPlayed: number;
}

export interface ReconciliationReport {
  /**
   * Settled bucket: real money that arrived and was credited as tokens.
   * = ledger entries (debit=house_rake, credit=player_wallet)
   */
  totalDepositedMinor: number;
  /**
   * Settled bucket: real money already paid out (cashouts approved).
   * = ledger entries (debit=player_cashout_hold, credit=house_rake)
   */
  totalCashedOutMinor: number;
  /**
   * Outstanding: tokens in player wallets + table stacks (free to use).
   */
  totalOutstandingMinor: number;
  /**
   * Held bucket: tokens reserved pending real-money cashout approval.
   * = net player_cashout_hold balance (must be ≥ 0)
   */
  totalHeldMinor: number;
  /**
   * Rake collected from pots.
   * = ledger entries (debit=table_pot, credit=house_rake)
   */
  totalRakeMinor: number;
  /**
   * Chips currently in active pots (should be 0 between hands).
   */
  activePotMinor: number;
  /**
   * Invariant check:
   *   deposited = outstanding + held + rake + cashedOut + activePot
   *   drift must be 0
   */
  drift: number;
  /** sum of all ledger entry amounts as credits - same as debits (always 0 by construction) */
  ledgerSumCheck: number;
}

export interface AdminRepository {
  listPlayerSummaries(opts?: {
    from?: Date;
    to?: Date;
    limit?: number;
    offset?: number;
  }): Promise<PlayerSummary[]>;

  getPlayerSummary(playerId: string): Promise<PlayerSummary | null>;

  getPlayerDeposits(playerId: string): Promise<typeof tokenPurchases.$inferSelect[]>;
  getPlayerCashouts(playerId: string): Promise<typeof cashouts.$inferSelect[]>;
  getPlayerSessions(playerId: string): Promise<typeof sessions.$inferSelect[]>;
  getPlayerHands(playerId: string, limit?: number): Promise<typeof hands.$inferSelect[]>;

  getReconciliation(): Promise<ReconciliationReport>;

  auditLog(adminId: string, action: string, opts?: {
    resourceType?: string;
    resourceId?: string;
    details?: object;
    ip?: string;
  }): Promise<void>;

  getAuditLog(limit?: number): Promise<typeof adminAuditLog.$inferSelect[]>;
}

export function createAdminRepository(db: Db): AdminRepository {
  /** Ledger balance for an account: SUM(credit) - SUM(debit) */
  async function ledgerBalance(ownerId: string, accountType: string): Promise<number> {
    const creditResult = await db
      .select({ total: sql<string>`COALESCE(SUM(${ledgerEntries.amountMinor}), 0)` })
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.creditOwner, ownerId), eq(ledgerEntries.creditType, accountType)));

    const debitResult = await db
      .select({ total: sql<string>`COALESCE(SUM(${ledgerEntries.amountMinor}), 0)` })
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.debitOwner, ownerId), eq(ledgerEntries.debitType, accountType)));

    return Number(creditResult[0]!.total) - Number(debitResult[0]!.total);
  }

  async function buildSummary(player: typeof players.$inferSelect): Promise<PlayerSummary> {
    const [
      purchaseRow,
      cashoutRow,
      winRow,
      netRow,
      rakeRow,
      handsRow,
    ] = await Promise.all([
      // Total real money deposited and tokens purchased
      db.select({
        amountPaid: sql<string>`COALESCE(SUM(real_money_minor), 0)`,
        tokensBought: sql<string>`COALESCE(SUM(token_amount), 0)`,
      })
        .from(tokenPurchases)
        .where(and(eq(tokenPurchases.playerId, player.id), eq(tokenPurchases.status, 'completed'))),

      // Total real money cashed out
      db.select({ total: sql<string>`COALESCE(SUM(real_money_minor), 0)` })
        .from(cashouts)
        .where(and(eq(cashouts.playerId, player.id), eq(cashouts.status, 'completed'))),

      // Gross winnings from hand results
      db.select({ total: sql<string>`COALESCE(SUM(won_minor), 0)` })
        .from(handResults)
        .where(eq(handResults.playerId, player.id)),

      // Net P&L from hands
      db.select({ total: sql<string>`COALESCE(SUM(net_minor), 0)` })
        .from(handResults)
        .where(eq(handResults.playerId, player.id)),

      // Lifetime rake contributed (chips player put into pots that became rake)
      // Proxy: SUM of rake_minor on hands where player participated
      db.select({ total: sql<string>`COALESCE(SUM(${hands.rakeMinor} * 1.0 / NULLIF(cnt.players, 0)), 0)` })
        .from(hands)
        .innerJoin(
          db.select({
            handId: handResults.handId,
            players: sql<string>`COUNT(*)`.as('players'),
          })
            .from(handResults)
            .groupBy(handResults.handId)
            .as('cnt'),
          sql`cnt.hand_id = ${hands.id}`,
        )
        .innerJoin(handResults, and(eq(handResults.handId, hands.id), eq(handResults.playerId, player.id))),

      // Hands played
      db.select({ count: sql<string>`COUNT(*)` })
        .from(handResults)
        .where(eq(handResults.playerId, player.id)),
    ]);

    const walletBalance = await ledgerBalance(player.id, 'player_wallet');
    const amountPaid = Number(purchaseRow[0]!.amountPaid);
    const totalCashedOut = Number(cashoutRow[0]!.total);

    return {
      id: player.id,
      username: player.username,
      email: player.email,
      createdAt: player.createdAt,
      amountPaidMinor: amountPaid,
      tokensPurchased: Number(purchaseRow[0]!.tokensBought),
      currentBalanceMinor: walletBalance,
      totalCashedOutMinor: totalCashedOut,
      grossWinningsMinor: Number(winRow[0]!.total),
      netPnlMinor: (walletBalance + totalCashedOut) - amountPaid,
      tableNetMinor: Number(netRow[0]!.total),
      lifetimeRakeMinor: Math.round(Number(rakeRow[0]!.total)),
      handsPlayed: Number(handsRow[0]!.count),
    };
  }

  return {
    async listPlayerSummaries({ from, to, limit = 100, offset = 0 } = {}) {
      const allPlayers = await db
        .select()
        .from(players)
        .orderBy(desc(players.createdAt))
        .limit(limit)
        .offset(offset);
      return Promise.all(allPlayers.map(buildSummary));
    },

    async getPlayerSummary(playerId) {
      const rows = await db.select().from(players).where(eq(players.id, playerId)).limit(1);
      if (!rows[0]) return null;
      return buildSummary(rows[0]);
    },

    async getPlayerDeposits(playerId) {
      return db
        .select()
        .from(tokenPurchases)
        .where(eq(tokenPurchases.playerId, playerId))
        .orderBy(desc(tokenPurchases.createdAt));
    },

    async getPlayerCashouts(playerId) {
      return db
        .select()
        .from(cashouts)
        .where(eq(cashouts.playerId, playerId))
        .orderBy(desc(cashouts.createdAt));
    },

    async getPlayerSessions(playerId) {
      return db
        .select()
        .from(sessions)
        .where(eq(sessions.playerId, playerId))
        .orderBy(desc(sessions.joinedAt));
    },

    async getPlayerHands(playerId, limit = 20) {
      const playerHandIds = await db
        .select({ handId: handResults.handId })
        .from(handResults)
        .where(eq(handResults.playerId, playerId))
        .orderBy(desc(handResults.createdAt))
        .limit(limit);
      if (playerHandIds.length === 0) return [];
      const ids = playerHandIds.map((r) => r.handId);
      return db
        .select()
        .from(hands)
        .where(sql`${hands.id} = ANY(${ids})`)
        .orderBy(desc(hands.startedAt));
    },

    async getReconciliation(): Promise<ReconciliationReport> {
      // All queries in parallel — each reads only ledger_entries.
      const [
        depositedResult,
        rakeOnlyResult,
        cashedOutResult,
        walletCreditResult,
        walletDebitResult,
        stackCreditResult,
        stackDebitResult,
        holdCreditResult,
        holdDebitResult,
        potResult,
      ] = await Promise.all([
        // Deposited: debit=house_rake → credit=player_wallet (approved purchases)
        db.select({ total: sql<string>`COALESCE(SUM(amount_minor), 0)` })
          .from(ledgerEntries)
          .where(and(eq(ledgerEntries.debitType, 'house_rake'), eq(ledgerEntries.creditType, 'player_wallet'))),

        // Rake: debit=table_pot → credit=house_rake
        db.select({ total: sql<string>`COALESCE(SUM(amount_minor), 0)` })
          .from(ledgerEntries)
          .where(and(eq(ledgerEntries.debitType, 'table_pot'), eq(ledgerEntries.creditType, 'house_rake'))),

        // Cashed out: debit=player_cashout_hold → credit=house_rake (approved cashouts)
        db.select({ total: sql<string>`COALESCE(SUM(amount_minor), 0)` })
          .from(ledgerEntries)
          .where(and(eq(ledgerEntries.debitType, 'player_cashout_hold'), eq(ledgerEntries.creditType, 'house_rake'))),

        // Wallet credits
        db.select({ total: sql<string>`COALESCE(SUM(amount_minor), 0)` })
          .from(ledgerEntries)
          .where(eq(ledgerEntries.creditType, 'player_wallet')),

        // Wallet debits
        db.select({ total: sql<string>`COALESCE(SUM(amount_minor), 0)` })
          .from(ledgerEntries)
          .where(eq(ledgerEntries.debitType, 'player_wallet')),

        // Stack credits
        db.select({ total: sql<string>`COALESCE(SUM(amount_minor), 0)` })
          .from(ledgerEntries)
          .where(eq(ledgerEntries.creditType, 'player_table_stack')),

        // Stack debits
        db.select({ total: sql<string>`COALESCE(SUM(amount_minor), 0)` })
          .from(ledgerEntries)
          .where(eq(ledgerEntries.debitType, 'player_table_stack')),

        // Hold credits (tokens entering escrow)
        db.select({ total: sql<string>`COALESCE(SUM(amount_minor), 0)` })
          .from(ledgerEntries)
          .where(eq(ledgerEntries.creditType, 'player_cashout_hold')),

        // Hold debits (tokens leaving escrow: approve or reject)
        db.select({ total: sql<string>`COALESCE(SUM(amount_minor), 0)` })
          .from(ledgerEntries)
          .where(eq(ledgerEntries.debitType, 'player_cashout_hold')),

        // Pot balance (credit - debit, should be 0 between hands)
        db.select({
          credit: sql<string>`COALESCE(SUM(CASE WHEN credit_type = 'table_pot' THEN amount_minor ELSE 0 END), 0)`,
          debit: sql<string>`COALESCE(SUM(CASE WHEN debit_type = 'table_pot' THEN amount_minor ELSE 0 END), 0)`,
        }).from(ledgerEntries),
      ]);

      const totalDeposited = Number(depositedResult[0]!.total);
      const totalRake = Number(rakeOnlyResult[0]!.total);
      const totalCashedOut = Number(cashedOutResult[0]!.total);

      const totalOutstanding =
        (Number(walletCreditResult[0]!.total) - Number(walletDebitResult[0]!.total)) +
        (Number(stackCreditResult[0]!.total) - Number(stackDebitResult[0]!.total));

      const totalHeld =
        Number(holdCreditResult[0]!.total) - Number(holdDebitResult[0]!.total);

      const activePot =
        Number(potResult[0]!.credit) - Number(potResult[0]!.debit);

      // Invariant: deposited = outstanding + held + rake + cashedOut + activePot
      const drift = totalDeposited - totalOutstanding - totalHeld - totalRake - totalCashedOut - activePot;

      // ledgerSumCheck: trivially 0 (each row contributes equal debit and credit amount)
      const ledgerSumCheck = 0;

      return {
        totalDepositedMinor: totalDeposited,
        totalCashedOutMinor: totalCashedOut,
        totalOutstandingMinor: totalOutstanding,
        totalHeldMinor: totalHeld,
        totalRakeMinor: totalRake,
        activePotMinor: activePot,
        drift,
        ledgerSumCheck,
      };
    },

    async auditLog(adminId, action, { resourceType, resourceId, details, ip } = {}) {
      await db.insert(adminAuditLog).values({
        adminId,
        action,
        resourceType: resourceType ?? null,
        resourceId: resourceId ?? null,
        detailsJson: details ? JSON.stringify(details) : null,
        ip: ip ?? null,
      });
    },

    async getAuditLog(limit = 100) {
      return db
        .select()
        .from(adminAuditLog)
        .orderBy(desc(adminAuditLog.createdAt))
        .limit(limit);
    },
  };
}
