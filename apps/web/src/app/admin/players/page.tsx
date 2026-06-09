export const dynamic = 'force-dynamic';
import { getDb, createAdminRepository } from '@poker/db';
import { formatMoney, formatTokens } from '@/lib/format';
import Link from 'next/link';

export default async function PlayersPage() {
  const summaries = await createAdminRepository(getDb()).listPlayerSummaries();

  return (
    <div className="max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Players ({summaries.length})</h1>
      <div className="bg-gray-900 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-gray-400 text-xs uppercase tracking-wide">
              <th className="text-left px-4 py-3">Player</th>
              <th className="text-right px-4 py-3">Balance</th>
              <th className="text-right px-4 py-3">Deposited</th>
              <th className="text-right px-4 py-3">Cashed out</th>
              <th className="text-right px-4 py-3">Net P&L</th>
              <th className="text-right px-4 py-3">Hands</th>
              <th className="text-right px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {summaries.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">No players yet.</td>
              </tr>
            )}
            {summaries.map((s) => (
              <tr key={s.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                <td className="px-4 py-3">
                  <p className="font-medium text-white">{s.username}</p>
                  <p className="text-gray-500 text-xs">{s.email ?? s.id.slice(0, 8)}</p>
                </td>
                <td className="px-4 py-3 text-right">
                  {s.balancesByCurrency.length === 0 ? (
                    <span className="font-mono text-gray-500">—</span>
                  ) : (
                    <div className="space-y-0.5">
                      {s.balancesByCurrency.map((b) => (
                        <div key={b.currencySymbol} className="font-mono text-sm text-white">
                          {b.currencySymbol}{(b.balanceCents / 100).toFixed(2)}
                        </div>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-right font-mono">{formatMoney(s.amountPaidMinor)}</td>
                <td className="px-4 py-3 text-right font-mono">{formatMoney(s.totalCashedOutMinor)}</td>
                <td className={`px-4 py-3 text-right font-mono ${s.netPnlMinor >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {s.netPnlMinor >= 0 ? '+' : ''}{formatMoney(s.netPnlMinor)}
                </td>
                <td className="px-4 py-3 text-right text-gray-300">{s.handsPlayed}</td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/admin/players/${s.id}`} className="text-blue-400 hover:text-blue-300 text-xs">
                    Detail →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
