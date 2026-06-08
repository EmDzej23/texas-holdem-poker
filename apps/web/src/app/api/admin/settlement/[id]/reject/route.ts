import { NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/admin-auth';
import { getDb, createPgLedgerStore, createSettlementRepository, createAdminRepository } from '@poker/db';
import { LedgerService } from '@poker/engine';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await req.json() as { type: 'purchase' | 'cashout'; reason: string };

  if (!body.reason?.trim()) {
    return NextResponse.json({ error: 'reason is required for rejection' }, { status: 400 });
  }
  if (!['purchase', 'cashout'].includes(body.type)) {
    return NextResponse.json({ error: 'type must be purchase or cashout' }, { status: 400 });
  }

  const db = getDb();
  const ledger = new LedgerService(createPgLedgerStore(db));
  const settlement = createSettlementRepository(db);
  const adminRepo = createAdminRepository(db);

  if (body.type === 'purchase') {
    await settlement.rejectPurchase({ purchaseId: id, adminId: admin.sub, reason: body.reason });
  } else {
    await settlement.rejectCashout({ cashoutId: id, adminId: admin.sub, reason: body.reason, ledger });
  }

  await adminRepo.auditLog(admin.sub, `reject_${body.type}`, { resourceType: body.type, resourceId: id, details: { reason: body.reason } });

  const recon = await adminRepo.getReconciliation();
  if (recon.drift !== 0) {
    console.error('[reconciliation] drift after rejection!', recon);
  }

  return NextResponse.json({ ok: true, drift: recon.drift });
}
