export const dynamic = 'force-dynamic';
import Link from 'next/link';
import { getDb, tableRecords } from '@poker/db';
import { desc } from 'drizzle-orm';

interface TableConfig {
  tableId: string;
  smallBlindCents: number;
  bigBlindCents: number;
  minBuyInCents: number;
  maxBuyInCents: number;
  maxSeats: number;
  rakePercent: number;
  currencySymbol?: string;
}

function fmt(cents: number, sym = '$') {
  return `${sym}${(cents / 100).toFixed(2).replace(/\.00$/, '')}`;
}

export default async function LobbyPage() {
  let tables: { tableId: string; config: TableConfig; seats: number }[] = [];
  try {
    const db = getDb();
    const rows = await db.select().from(tableRecords).orderBy(desc(tableRecords.createdAt));
    tables = rows.map((r) => {
      const config = JSON.parse(r.configJson) as TableConfig;
      let seats = 0;
      try {
        const s = JSON.parse(r.seatsJson) as { status: string }[];
        seats = s.filter((seat) => seat.status !== 'empty').length;
      } catch { /* ignore */ }
      return { tableId: r.tableId, config, seats };
    });
  } catch { /* DB unavailable — show empty state */ }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-8 p-8">
      <div className="text-center">
        <h1 className="text-5xl font-bold text-white mb-2">♠ Texas Hold&apos;em</h1>
        <p className="text-gray-400">Multiplayer cash game</p>
      </div>

      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md">
        <h2 className="text-white font-semibold mb-4">Available Tables</h2>
        {tables.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-4">No tables yet. Ask an admin to create one.</p>
        ) : (
          <div className="space-y-3">
            {tables.map(({ tableId, config, seats }) => {
              const sym = config.currencySymbol ?? '$';
              return (
                <div key={tableId} className="flex items-center justify-between bg-gray-800 rounded-xl p-4">
                  <div>
                    <div className="text-white font-medium">{tableId}</div>
                    <div className="text-gray-400 text-sm">
                      {fmt(config.smallBlindCents, sym)}/{fmt(config.bigBlindCents, sym)} &middot; {config.maxSeats}-max
                    </div>
                    <div className="text-gray-500 text-xs mt-0.5">
                      Buy-in {fmt(config.minBuyInCents, sym)}–{fmt(config.maxBuyInCents, sym)}
                      {seats > 0 && <span className="ml-2 text-green-500">{seats} seated</span>}
                    </div>
                  </div>
                  <Link
                    href={`/table/${tableId}`}
                    className="px-4 py-2 bg-yellow-500 hover:bg-yellow-400 text-black font-bold rounded-lg text-sm transition-colors"
                  >
                    Join
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
