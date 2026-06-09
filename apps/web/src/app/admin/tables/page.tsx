export const dynamic = 'force-dynamic';
import { getDb } from '@poker/db';
import { tableRecords } from '@poker/db';
import type { TableConfig } from '@poker/engine';
import { TablesClient } from './TablesClient';

export default async function TablesPage() {
  const db = getDb();
  const rows = await db.select().from(tableRecords).orderBy(tableRecords.createdAt);
  const tables = rows.map((r) => ({
    tableId: r.tableId,
    config: JSON.parse(r.configJson) as TableConfig,
  }));

  const appUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3000';

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Tables</h1>
      </div>
      <TablesClient tables={tables} appUrl={appUrl} />
    </div>
  );
}
