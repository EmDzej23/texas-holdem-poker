import { NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/admin-auth';
import { getDb } from '@poker/db';
import { tableRecords } from '@poker/db';
import type { TableConfig } from '@poker/engine';

function wsUrl() {
  return process.env['WS_SERVICE_URL'] ?? 'http://localhost:8080';
}
function wsSecret() {
  return process.env['WS_ADMIN_SECRET'] ?? '';
}

// GET /api/admin/tables — read configs from DB
export async function GET() {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDb();
  const rows = await db.select().from(tableRecords).orderBy(tableRecords.createdAt);
  const tables = rows.map((r) => ({
    tableId: r.tableId,
    config: JSON.parse(r.configJson) as TableConfig,
    createdAt: r.createdAt,
  }));
  return NextResponse.json(tables);
}

// POST /api/admin/tables — create a new table
export async function POST(req: Request) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const config = (await req.json()) as TableConfig;
  if (!config?.tableId) return NextResponse.json({ error: 'tableId required' }, { status: 400 });

  const upstream = await fetch(`${wsUrl()}/admin/create-table`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-secret': wsSecret() },
    body: JSON.stringify(config),
  });
  const result = await upstream.json() as unknown;
  return NextResponse.json(result, { status: upstream.ok ? 201 : upstream.status });
}
