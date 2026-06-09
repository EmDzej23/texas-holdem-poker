import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { getDb } from '@poker/db';
import { ledgerEntries } from '@poker/db';
import { eq, and, sql } from 'drizzle-orm';

async function getWalletBalance(playerId: string): Promise<number> {
  const db = getDb();
  const [credits, debits] = await Promise.all([
    db
      .select({ total: sql<string>`COALESCE(SUM(${ledgerEntries.amountMinor}), 0)` })
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.creditOwner, playerId), eq(ledgerEntries.creditType, 'player_wallet'))),
    db
      .select({ total: sql<string>`COALESCE(SUM(${ledgerEntries.amountMinor}), 0)` })
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.debitOwner, playerId), eq(ledgerEntries.debitType, 'player_wallet'))),
  ]);
  return Number(credits[0]?.total ?? 0) - Number(debits[0]?.total ?? 0);
}

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const balance = await getWalletBalance(session.user.id);
  return NextResponse.json({ walletBalanceCents: balance });
}
