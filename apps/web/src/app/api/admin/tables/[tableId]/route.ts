import { NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/admin-auth';

function wsUrl() {
  return process.env['WS_SERVICE_URL'] ?? 'http://localhost:8080';
}
function wsSecret() {
  return process.env['WS_ADMIN_SECRET'] ?? '';
}

// PATCH /api/admin/tables/[tableId] — update rake settings
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ tableId: string }> },
) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { tableId } = await params;
  const body = (await req.json()) as { rakePercent?: number; rakeCapCents?: number };

  const upstream = await fetch(`${wsUrl()}/admin/update-table`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-admin-secret': wsSecret() },
    body: JSON.stringify({ tableId, ...body }),
  });
  const result = await upstream.json() as unknown;
  return NextResponse.json(result, { status: upstream.ok ? 200 : upstream.status });
}
