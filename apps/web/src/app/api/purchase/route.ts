/**
 * POST /api/purchase — player creates a pending token-purchase request.
 * No ledger entry is created; tokens are credited only when admin approves.
 */
import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { getDb, createSettlementRepository } from '@poker/db';

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json() as { tokenAmount?: unknown };
  const tokenAmount = Number(body.tokenAmount);

  if (!Number.isInteger(tokenAmount) || tokenAmount < 100 || tokenAmount > 10_000_000) {
    return NextResponse.json(
      { error: 'tokenAmount must be an integer between 100 and 10,000,000' },
      { status: 400 },
    );
  }

  const settlement = createSettlementRepository(getDb());
  const id = await settlement.createPurchaseRequest({
    playerId: session.user.id,
    tokenAmount,
  });

  return NextResponse.json({ id, tokenAmount, realMoneyMinor: tokenAmount }, { status: 201 });
}
