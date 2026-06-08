export const dynamic = 'force-dynamic';
import { getDb, createAdminRepository, createSettlementRepository } from '@poker/db';
import { formatMoney, formatTokens } from '@/lib/format';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SettlementActions } from '@/components/SettlementActions';

export default async function PlayerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const [summary, purchases, cashouts] = await Promise.all([
    createAdminRepository(db).getPlayerSummary(id),
    createSettlementRepository(db).getPurchasesForPlayer(id),
    createSettlementRepository(db).getCashoutsForPlayer(id),
  ]);

  if (!summary) notFound();

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/admin/players" className="text-gray-400 hover:text-white text-sm">← Players</Link>
        <h1 className="text-2xl font-bold">{summary.username}</h1>
        <span className="text-gray-500 text-sm">{summary.email}</span>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Balance" value={formatMoney(summary.currentBalanceMinor)} />
        <Stat label="Total deposited" value={formatMoney(summary.amountPaidMinor)} />
        <Stat label="Total cashed out" value={formatMoney(summary.totalCashedOutMinor)} />
        <Stat label="Net P&L" value={formatMoney(summary.netPnlMinor)} pos={summary.netPnlMinor >= 0} />
        <Stat label="Table net" value={formatMoney(summary.tableNetMinor)} />
        <Stat label="Gross winnings" value={formatMoney(summary.grossWinningsMinor)} />
        <Stat label="Lifetime rake" value={formatMoney(summary.lifetimeRakeMinor)} />
        <Stat label="Hands played" value={String(summary.handsPlayed)} />
      </div>

      {/* Pending purchases */}
      <Section title="Token purchases">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-gray-400 text-xs uppercase">
              <th className="text-left py-2">Date</th>
              <th className="text-right py-2">Tokens</th>
              <th className="text-right py-2">Real money</th>
              <th className="text-right py-2">Status</th>
              <th className="text-right py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {purchases.map((p) => (
              <tr key={p.id} className="border-b border-gray-800/50">
                <td className="py-2 text-gray-300">{p.createdAt.toLocaleDateString()}</td>
                <td className="py-2 text-right">{formatTokens(p.tokenAmount)}</td>
                <td className="py-2 text-right">{formatMoney(p.realMoneyMinor)}</td>
                <td className="py-2 text-right"><StatusBadge status={p.status} /></td>
                <td className="py-2 text-right">
                  {p.status === 'pending' && (
                    <SettlementActions id={p.id} type="purchase" />
                  )}
                  {p.status !== 'pending' && p.actionReason && (
                    <span className="text-xs text-gray-500">{p.actionReason}</span>
                  )}
                </td>
              </tr>
            ))}
            {purchases.length === 0 && (
              <tr><td colSpan={5} className="py-4 text-gray-500 text-center">None</td></tr>
            )}
          </tbody>
        </table>
      </Section>

      {/* Pending cashouts */}
      <Section title="Cashouts">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-gray-400 text-xs uppercase">
              <th className="text-left py-2">Date</th>
              <th className="text-right py-2">Tokens</th>
              <th className="text-right py-2">Real money</th>
              <th className="text-right py-2">Status</th>
              <th className="text-right py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {cashouts.map((c) => (
              <tr key={c.id} className="border-b border-gray-800/50">
                <td className="py-2 text-gray-300">{c.createdAt.toLocaleDateString()}</td>
                <td className="py-2 text-right">{formatTokens(c.tokenAmount)}</td>
                <td className="py-2 text-right">{formatMoney(c.realMoneyMinor)}</td>
                <td className="py-2 text-right"><StatusBadge status={c.status} /></td>
                <td className="py-2 text-right">
                  {c.status === 'pending' && (
                    <SettlementActions id={c.id} type="cashout" />
                  )}
                  {c.status !== 'pending' && c.actionReason && (
                    <span className="text-xs text-gray-500">{c.actionReason}</span>
                  )}
                </td>
              </tr>
            ))}
            {cashouts.length === 0 && (
              <tr><td colSpan={5} className="py-4 text-gray-500 text-center">None</td></tr>
            )}
          </tbody>
        </table>
      </Section>
    </div>
  );
}

function Stat({ label, value, pos }: { label: string; value: string; pos?: boolean }) {
  return (
    <div className="bg-gray-900 rounded-xl p-4">
      <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-lg font-bold font-mono ${pos === true ? 'text-green-400' : pos === false ? 'text-red-400' : 'text-white'}`}>
        {value}
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-900 rounded-xl p-6">
      <h2 className="font-semibold mb-4">{title}</h2>
      {children}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color =
    status === 'approved' ? 'text-green-400 bg-green-950/50' :
    status === 'rejected' ? 'text-red-400 bg-red-950/50' :
    'text-yellow-400 bg-yellow-950/50';
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${color}`}>{status}</span>;
}
