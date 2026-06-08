import { NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/admin-auth';
import { getDb, createSettlementRepository } from '@poker/db';

export async function GET(req: Request) {
  if (!await getAdminSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const url = new URL(req.url);
  const status = url.searchParams.get('status') ?? 'pending';
  const type = url.searchParams.get('type') as 'purchase' | 'cashout' | undefined ?? undefined;
  const playerId = url.searchParams.get('playerId') ?? undefined;

  const items = await createSettlementRepository(getDb()).listSettlements({ status, type, playerId });
  return NextResponse.json(items);
}
