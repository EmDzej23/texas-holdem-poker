import { NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/admin-auth';
import { getDb, createAdminRepository, createSettlementRepository } from '@poker/db';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!await getAdminSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  const [summary, purchases, cashouts] = await Promise.all([
    createAdminRepository(db).getPlayerSummary(id),
    createSettlementRepository(db).getPurchasesForPlayer(id),
    createSettlementRepository(db).getCashoutsForPlayer(id),
  ]);
  if (!summary) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ summary, purchases, cashouts });
}
