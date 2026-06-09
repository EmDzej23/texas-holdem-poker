import { NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/admin-auth';
import { getDb } from '@poker/db';
import { ledgerEntries, tokenPurchases, cashouts } from '@poker/db';
import { eq } from 'drizzle-orm';

export async function DELETE() {
  if (!await getAdminSession()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDb();

  try {
    await db.delete(ledgerEntries);
    await db.update(tokenPurchases)
      .set({ status: 'cancelled' })
      .where(eq(tokenPurchases.status, 'pending'));
    await db.update(cashouts)
      .set({ status: 'cancelled' })
      .where(eq(cashouts.status, 'pending'));

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /api/admin/reset-balances]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
