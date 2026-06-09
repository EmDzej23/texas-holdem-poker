import { NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/admin-auth';
import { getDb } from '@poker/db';
import { ledgerEntries, tokenPurchases, cashouts, sessions, handResults, handActions, hands } from '@poker/db';

export async function DELETE() {
  if (!await getAdminSession()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDb();

  try {
    // Delete in dependency order (child rows first)
    await db.delete(handResults);
    await db.delete(handActions);
    await db.delete(hands);
    await db.delete(sessions);
    await db.delete(ledgerEntries);
    await db.delete(tokenPurchases);
    await db.delete(cashouts);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /api/admin/reset-balances]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
