import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { getDb, createPgLedgerStore } from '@poker/db';
import { LedgerService } from '@poker/engine';
import { randomUUID } from 'node:crypto';

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json() as { amountCents?: unknown };
  const amountCents = Number(body.amountCents);

  if (!Number.isInteger(amountCents) || amountCents < 100 || amountCents > 100_000_00) {
    return NextResponse.json(
      { error: 'amountCents must be an integer between 100 and 10,000,000' },
      { status: 400 },
    );
  }

  const db = getDb();
  const ledger = new LedgerService(createPgLedgerStore(db));

  try {
    await ledger.deposit(session.user.id, amountCents, `deposit:${randomUUID()}`);
    const newBalance = await ledger.getBalance({ type: 'player_wallet', ownerId: session.user.id });
    return NextResponse.json({ walletBalanceCents: newBalance });
  } catch (err) {
    console.error('[POST /api/player/deposit]', err);
    return NextResponse.json({ error: 'Failed to add funds' }, { status: 500 });
  }
}
