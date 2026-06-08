/**
 * POST /api/cashout — player requests a real-money withdrawal.
 * Tokens are IMMEDIATELY held (moved to escrow) so they can't be spent.
 * Admin must approve before real money is paid out.
 */
import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { getDb, createPgLedgerStore, createSettlementRepository } from '@poker/db';
import { LedgerService } from '@poker/engine';

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json() as { tokenAmount?: unknown };
  const tokenAmount = Number(body.tokenAmount);

  if (!Number.isInteger(tokenAmount) || tokenAmount < 100) {
    return NextResponse.json(
      { error: 'tokenAmount must be an integer ≥ 100' },
      { status: 400 },
    );
  }

  const db = getDb();
  const ledger = new LedgerService(createPgLedgerStore(db));

  // Check available (non-held) balance
  const walletBalance = await ledger.getBalance({ type: 'player_wallet', ownerId: session.user.id });
  if (walletBalance < tokenAmount) {
    return NextResponse.json(
      { error: `Insufficient balance: have ${walletBalance}, requested ${tokenAmount}` },
      { status: 400 },
    );
  }

  const settlement = createSettlementRepository(db);
  const id = await settlement.requestCashout({
    playerId: session.user.id,
    tokenAmount,
    ledger,
  });

  return NextResponse.json({ id, tokenAmount, realMoneyMinor: tokenAmount }, { status: 201 });
}
