import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { getDb, createPgLedgerStore, getWalletBalancesByCurrency } from '@poker/db';
import { LedgerService } from '@poker/engine';
import { randomUUID } from 'node:crypto';

export async function POST(req: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body: { amountCents?: unknown; currencySymbol?: unknown };
    try {
      body = await req.json() as { amountCents?: unknown; currencySymbol?: unknown };
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const amountCents = Number(body.amountCents);
    const currencySymbol = typeof body.currencySymbol === 'string' && body.currencySymbol.trim()
      ? body.currencySymbol.trim()
      : '$';

    if (!Number.isInteger(amountCents) || amountCents < 100 || amountCents > 10_000_000) {
      return NextResponse.json(
        { error: 'amountCents must be an integer between 100 and 10,000,000' },
        { status: 400 },
      );
    }

    const db = getDb();
    const ledger = new LedgerService(createPgLedgerStore(db));

    await ledger.record({
      idempotencyKey: `deposit:${randomUUID()}`,
      description: `Deposit: player ${session.user.id}`,
      debit: { type: 'house_rake', ownerId: 'house' },
      credit: { type: 'player_wallet', ownerId: session.user.id },
      amountCents,
      currencySymbol,
    });
    const balances = await getWalletBalancesByCurrency(db, session.user.id);
    return NextResponse.json({ balances });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[POST /api/player/deposit]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
