import { getDb, createSettlementRepository } from '@poker/db';
import { formatMoney, formatTokens } from '@/lib/format';
import Link from 'next/link';
import { SettlementActions } from '@/components/SettlementActions';

export default async function SettlementPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; type?: string }>;
}) {
  const sp = await searchParams;
  const status = sp.status ?? 'pending';
  const type = sp.type as 'purchase' | 'cashout' | undefined;

  const settlements = await createSettlementRepository(getDb()).listSettlements({ status, type });

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Settlement queue</h1>
        <div className="flex gap-2 text-sm">
          <FilterLink href="/admin/settlement" label="All pending" active={!type && status === 'pending'} />
          <FilterLink href="/admin/settlement?type=purchase" label="Purchases" active={type === 'purchase'} />
          <FilterLink href="/admin/settlement?type=cashout" label="Cashouts" active={type === 'cashout'} />
          <FilterLink href="/admin/settlement?status=approved" label="Approved" active={status === 'approved'} />
          <FilterLink href="/admin/settlement?status=rejected" label="Rejected" active={status === 'rejected'} />
        </div>
      </div>

      <div className="bg-gray-900 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-gray-400 text-xs uppercase tracking-wide">
              <th className="text-left px-4 py-3">Type</th>
              <th className="text-left px-4 py-3">Player</th>
              <th className="text-right px-4 py-3">Tokens</th>
              <th className="text-right px-4 py-3">Real money</th>
              <th className="text-right px-4 py-3">Date</th>
              <th className="text-right px-4 py-3">Status</th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {settlements.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                  No items.
                </td>
              </tr>
            )}
            {settlements.map((s) => (
              <tr key={`${s.type}-${s.id}`} className="border-b border-gray-800/50">
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    s.type === 'purchase' ? 'bg-yellow-950/50 text-yellow-300' : 'bg-blue-950/50 text-blue-300'
                  }`}>
                    {s.type === 'purchase' ? 'Buy-in' : 'Cashout'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <Link href={`/admin/players/${s.playerId}`} className="text-blue-400 hover:text-blue-300">
                    {s.playerId.slice(0, 8)}…
                  </Link>
                </td>
                <td className="px-4 py-3 text-right">{formatTokens(s.tokenAmount)}</td>
                <td className="px-4 py-3 text-right font-mono">{formatMoney(s.realMoneyMinor)}</td>
                <td className="px-4 py-3 text-right text-gray-400">{s.createdAt.toLocaleDateString()}</td>
                <td className="px-4 py-3 text-right">
                  <StatusBadge status={s.status} />
                </td>
                <td className="px-4 py-3 text-right">
                  {s.status === 'pending' && <SettlementActions id={s.id} type={s.type} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FilterLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`px-3 py-1 rounded-lg transition ${
        active ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'
      }`}
    >
      {label}
    </Link>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color =
    status === 'approved' ? 'text-green-400 bg-green-950/50' :
    status === 'rejected' ? 'text-red-400 bg-red-950/50' :
    'text-yellow-400 bg-yellow-950/50';
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${color}`}>{status}</span>;
}
