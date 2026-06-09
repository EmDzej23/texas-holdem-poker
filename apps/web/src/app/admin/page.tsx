export const dynamic = 'force-dynamic';
import { getDb, createAdminRepository, createSettlementRepository } from '@poker/db';
import { formatMoney } from '@/lib/format';
import Link from 'next/link';

export default async function AdminDashboard() {
  const db = getDb();
  const [recon, settlements] = await Promise.all([
    createAdminRepository(db).getReconciliation(),
    createSettlementRepository(db).listSettlements({ status: 'pending' }),
  ]);

  const pendingPurchases = settlements.filter((s) => s.type === 'purchase');
  const pendingCashouts = settlements.filter((s) => s.type === 'cashout');

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      {/* Reconciliation banner */}
      <div className={`rounded-xl p-5 border ${recon.drift === 0 ? 'bg-green-950/30 border-green-800' : 'bg-red-950/40 border-red-600'}`}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Ledger health</h2>
          <span className={`text-sm font-mono font-bold ${recon.drift === 0 ? 'text-green-400' : 'text-red-400'}`}>
            drift = {recon.drift}
          </span>
        </div>
        <div className="grid grid-cols-3 md:grid-cols-5 gap-4 text-sm">
          <Metric label="Deposited" value={formatMoney(recon.totalDepositedMinor)} />
          <Metric label="Outstanding" value={formatMoney(recon.totalOutstandingMinor)} />
          <Metric label="Held" value={formatMoney(recon.totalHeldMinor)} />
          <Metric label="Rake" value={formatMoney(recon.totalRakeMinor)} />
          <Metric label="Cashed out" value={formatMoney(recon.totalCashedOutMinor)} />
        </div>
        <p className="text-xs text-gray-500 mt-3">
          deposited = outstanding + held + rake + cashed_out + active_pot
        </p>
      </div>

      {/* Pending actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <ActionCard
          title="Pending purchases"
          count={pendingPurchases.length}
          total={pendingPurchases.reduce((s, p) => s + p.realMoneyMinor, 0)}
          href="/admin/settlement?type=purchase"
          color="yellow"
        />
        <ActionCard
          title="Pending cashouts"
          count={pendingCashouts.length}
          total={pendingCashouts.reduce((s, p) => s + p.realMoneyMinor, 0)}
          href="/admin/settlement?type=cashout"
          color="blue"
        />
      </div>

      <div className="flex gap-4 text-sm text-gray-400">
        <Link href="/admin/reconciliation" className="hover:text-white underline">View full reconciliation report →</Link>
        <Link href="/admin/tables" className="hover:text-white underline">Manage tables →</Link>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-gray-400 text-xs">{label}</p>
      <p className="font-mono text-white">{value}</p>
    </div>
  );
}

function ActionCard({ title, count, total, href, color }: {
  title: string; count: number; total: number; href: string; color: 'yellow' | 'blue';
}) {
  const c = color === 'yellow'
    ? 'bg-yellow-950/30 border-yellow-800 text-yellow-300'
    : 'bg-blue-950/30 border-blue-800 text-blue-300';
  return (
    <Link href={href} className={`rounded-xl p-5 border block hover:opacity-80 transition ${c}`}>
      <p className="text-2xl font-bold">{count}</p>
      <p className="font-semibold mt-1">{title}</p>
      <p className="text-sm opacity-70 mt-1">Total: {formatMoney(total)}</p>
    </Link>
  );
}
