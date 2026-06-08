/**
 * GET /api/profile — returns the authenticated player's ledger-derived summary.
 * Scoped server-side to the logged-in player_id; never exposes other players' data.
 */
import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { getDb, createPgLedgerStore, createSettlementRepository } from '@poker/db';
import { LedgerService } from '@poker/engine';
import { eq, and } from 'drizzle-orm';
import { handResults, sessions } from '@poker/db';

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const playerId = session.user.id;
  const db = getDb();
  const ledger = new LedgerService(createPgLedgerStore(db));
  const settlement = createSettlementRepository(db);

  const [
    walletBalance,
    heldBalance,
    purchases,
    cashouts,
    sessionRows,
    handResultRows,
  ] = await Promise.all([
    ledger.getBalance({ type: 'player_wallet', ownerId: playerId }),
    ledger.getBalance({ type: 'player_cashout_hold', ownerId: playerId }),
    settlement.getPurchasesForPlayer(playerId),
    settlement.getCashoutsForPlayer(playerId),
    db.select().from(sessions).where(eq(sessions.playerId, playerId)).orderBy(sessions.joinedAt),
    db.select().from(handResults).where(eq(handResults.playerId, playerId)),
  ]);

  const totalDeposited = purchases
    .filter((p) => p.status === 'approved')
    .reduce((s, p) => s + p.realMoneyMinor, 0);

  const pendingDeposits = purchases
    .filter((p) => p.status === 'pending')
    .reduce((s, p) => s + p.realMoneyMinor, 0);

  const totalCashedOut = cashouts
    .filter((c) => c.status === 'approved')
    .reduce((s, c) => s + c.realMoneyMinor, 0);

  const pendingCashouts = cashouts
    .filter((c) => c.status === 'pending')
    .reduce((s, c) => s + c.realMoneyMinor, 0);

  const grossWinnings = handResultRows.reduce((s, r) => s + r.wonMinor, 0);
  const tableNet = handResultRows.reduce((s, r) => s + r.netMinor, 0);

  // Net result = (current balance + held + total cashed out) − total deposited
  const netResult = (walletBalance + heldBalance + totalCashedOut) - totalDeposited;

  return NextResponse.json({
    playerId,
    username: session.user.name,
    email: session.user.email,
    // Spent
    totalDeposited,        // sum of approved purchases real_money_minor
    netSpent: totalDeposited - totalCashedOut, // net out of pocket
    // Balance
    walletTokens: walletBalance,
    heldTokens: heldBalance,
    withdrawableTokens: walletBalance, // excludes held
    // Due / pending
    pendingDeposits,       // pending purchase requests (owed in real life)
    pendingCashouts,       // awaiting payout
    // P&L
    totalCashedOut,
    netResult,             // lifetime win/loss
    grossWinnings,
    tableNet,
    handsPlayed: handResultRows.length,
  });
}
