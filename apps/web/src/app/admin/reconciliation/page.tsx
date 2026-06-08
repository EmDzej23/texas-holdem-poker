export const dynamic = 'force-dynamic';
import { getDb, createAdminRepository } from '@poker/db';
import { formatMoney } from '@/lib/format';

export default async function ReconciliationPage() {
  const report = await createAdminRepository(getDb()).getReconciliation();

  const rows = [
    { label: 'Total deposited (approved purchases)', value: report.totalDepositedMinor, sign: '+', color: 'text-green-400' },
    { label: 'Outstanding (wallets + table stacks)', value: report.totalOutstandingMinor, sign: '−', color: 'text-white' },
    { label: 'Held (pending cashout escrow)', value: report.totalHeldMinor, sign: '−', color: 'text-blue-400' },
    { label: 'Rake collected', value: report.totalRakeMinor, sign: '−', color: 'text-white' },
    { label: 'Cashed out (settled)', value: report.totalCashedOutMinor, sign: '−', color: 'text-white' },
    { label: 'Active pots (should be 0)', value: report.activePotMinor, sign: '−', color: report.activePotMinor === 0 ? 'text-gray-500' : 'text-yellow-400' },
  ];

  const ok = report.drift === 0;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Reconciliation</h1>

      <div className={`rounded-xl p-6 border ${ok ? 'bg-green-950/20 border-green-700' : 'bg-red-950/30 border-red-600'}`}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-semibold text-lg">
            {ok ? '✓ Ledger balanced' : '✗ Drift detected!'}
          </h2>
          <span className={`font-mono text-xl font-bold ${ok ? 'text-green-400' : 'text-red-400'}`}>
            drift = {report.drift}
          </span>
        </div>
        <p className="text-gray-400 text-sm">
          deposited = outstanding + held + rake + cashed_out + active_pot
        </p>
      </div>

      <div className="bg-gray-900 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-gray-400 text-xs uppercase">
              <th className="text-left px-4 py-3">Bucket</th>
              <th className="text-center px-4 py-3">Side</th>
              <th className="text-right px-4 py-3">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-b border-gray-800/50">
                <td className="px-4 py-3 text-gray-300">{r.label}</td>
                <td className="px-4 py-3 text-center text-gray-500 font-mono">{r.sign}</td>
                <td className={`px-4 py-3 text-right font-mono ${r.color}`}>
                  {formatMoney(r.value)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className={`border-t-2 ${ok ? 'border-green-700' : 'border-red-600'}`}>
              <td className="px-4 py-3 font-semibold" colSpan={2}>Drift (must be 0)</td>
              <td className={`px-4 py-3 text-right font-mono font-bold text-xl ${ok ? 'text-green-400' : 'text-red-400'}`}>
                {formatMoney(report.drift)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="bg-gray-900 rounded-xl p-4 text-sm text-gray-400 space-y-1">
        <p><strong className="text-white">Deposited</strong> — ledger entries (debit=house_rake → credit=player_wallet) i.e. approved token purchases.</p>
        <p><strong className="text-white">Outstanding</strong> — net balance of all player wallets and table stacks; excludes held tokens.</p>
        <p><strong className="text-white">Held</strong> — tokens in escrow for pending cashout requests. Player cannot spend them; real money not yet paid.</p>
        <p><strong className="text-white">Rake</strong> — ledger entries (debit=table_pot → credit=house_rake).</p>
        <p><strong className="text-white">Cashed out</strong> — ledger entries (debit=player_cashout_hold → credit=house_rake) i.e. settled cashouts.</p>
      </div>
    </div>
  );
}
