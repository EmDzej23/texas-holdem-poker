import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { getDb, getWalletBalancesByCurrency } from '@poker/db';

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const balances = await getWalletBalancesByCurrency(getDb(), session.user.id);
  // Legacy field kept for backward compat (used when table currency is unknown)
  const walletBalanceCents = balances.reduce((s, b) => s + b.balanceCents, 0);
  return NextResponse.json({ walletBalanceCents, balances });
}
