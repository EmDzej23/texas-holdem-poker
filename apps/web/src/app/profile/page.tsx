export const dynamic = 'force-dynamic';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { getDb, createSettlementRepository, getWalletBalancesByCurrency, ledgerEntries } from '@poker/db';
import { eq, and, sql } from 'drizzle-orm';
import { handResults } from '@poker/db';
import Link from 'next/link';
import { PurchaseForm } from '@/components/PurchaseForm';
import { CashoutForm } from '@/components/CashoutForm';
import type { CurrencyBalance } from '@poker/db';

export default async function ProfilePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/login');

  const playerId = session.user.id;
  const db = getDb();
  const settlement = createSettlementRepository(db);

  const [
    walletBalances,
    heldBalances,
    cashouts,
    handResultRows,
    depositedByCurrency,
  ] = await Promise.all([
    getWalletBalancesByCurrency(db, playerId),

    // Held in cashout escrow — per currency
    (async (): Promise<CurrencyBalance[]> => {
      const [credits, debits] = await Promise.all([
        db.select({
          currencySymbol: ledgerEntries.currencySymbol,
          total: sql<string>`COALESCE(SUM(${ledgerEntries.amountMinor}), 0)`,
        })
          .from(ledgerEntries)
          .where(and(eq(ledgerEntries.creditOwner, playerId), eq(ledgerEntries.creditType, 'player_cashout_hold')))
          .groupBy(ledgerEntries.currencySymbol),
        db.select({
          currencySymbol: ledgerEntries.currencySymbol,
          total: sql<string>`COALESCE(SUM(${ledgerEntries.amountMinor}), 0)`,
        })
          .from(ledgerEntries)
          .where(and(eq(ledgerEntries.debitOwner, playerId), eq(ledgerEntries.debitType, 'player_cashout_hold')))
          .groupBy(ledgerEntries.currencySymbol),
      ]);
      const map = new Map<string, number>();
      for (const r of credits) map.set(r.currencySymbol, (map.get(r.currencySymbol) ?? 0) + Number(r.total));
      for (const r of debits) map.set(r.currencySymbol, (map.get(r.currencySymbol) ?? 0) - Number(r.total));
      return [...map.entries()]
        .map(([currencySymbol, balanceCents]) => ({ currencySymbol, balanceCents }))
        .filter((b) => b.balanceCents > 0);
    })(),

    settlement.getCashoutsForPlayer(playerId),
    db.select().from(handResults).where(eq(handResults.playerId, playerId)).orderBy(handResults.createdAt),

    // Total deposited per currency (ledger: debit=house_rake → credit=player_wallet)
    (async (): Promise<CurrencyBalance[]> => {
      const rows = await db.select({
        currencySymbol: ledgerEntries.currencySymbol,
        total: sql<string>`COALESCE(SUM(${ledgerEntries.amountMinor}), 0)`,
      })
        .from(ledgerEntries)
        .where(and(
          eq(ledgerEntries.creditOwner, playerId),
          eq(ledgerEntries.creditType, 'player_wallet'),
          eq(ledgerEntries.debitType, 'house_rake'),
        ))
        .groupBy(ledgerEntries.currencySymbol);
      return rows.map((r) => ({ currencySymbol: r.currencySymbol, balanceCents: Number(r.total) }));
    })(),
  ]);

  const pendingCashoutAmount = cashouts.filter((c) => c.status === 'pending').reduce((s, c) => s + c.realMoneyMinor, 0);
  const tableNet = handResultRows.reduce((s, r) => s + r.netMinor, 0);

  // All currencies touched by this player
  const allCurrencies = [...new Set([
    ...walletBalances.map((b) => b.currencySymbol),
    ...heldBalances.map((b) => b.currencySymbol),
    ...depositedByCurrency.map((b) => b.currencySymbol),
  ])].sort();

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <nav className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-gray-400 hover:text-white text-sm">← Table</Link>
          <span className="text-white font-semibold">{session.user.name}</span>
          <span className="text-gray-500 text-sm">{session.user.email}</span>
        </div>
        <form action="/api/auth/sign-out" method="POST">
          <button className="text-gray-400 hover:text-white text-sm">Sign out</button>
        </form>
      </nav>

      <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">

        {/* Per-currency balance summary */}
        {allCurrencies.length === 0 ? (
          <div className="bg-gray-900 rounded-xl p-6 text-center text-gray-400 text-sm">
            No balance yet. Add funds below to get started.
          </div>
        ) : (
          <div className="bg-gray-900 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-800">
              <h2 className="font-semibold text-sm text-gray-300 uppercase tracking-wide">Wallet balances</h2>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 text-xs border-b border-gray-800">
                  <th className="text-left px-5 py-2 font-medium">Currency</th>
                  <th className="text-right px-5 py-2 font-medium">Available</th>
                  <th className="text-right px-5 py-2 font-medium">Held (cashout)</th>
                  <th className="text-right px-5 py-2 font-medium">Total deposited</th>
                  <th className="text-right px-5 py-2 font-medium">Net P&amp;L</th>
                </tr>
              </thead>
              <tbody>
                {allCurrencies.map((sym) => {
                  const avail = walletBalances.find((b) => b.currencySymbol === sym)?.balanceCents ?? 0;
                  const held = heldBalances.find((b) => b.currencySymbol === sym)?.balanceCents ?? 0;
                  const deposited = depositedByCurrency.find((b) => b.currencySymbol === sym)?.balanceCents ?? 0;
                  const net = avail + held - deposited;
                  return (
                    <tr key={sym} className="border-b border-gray-800/50 last:border-0">
                      <td className="px-5 py-3 font-bold text-gray-200">{sym}</td>
                      <td className="px-5 py-3 text-right font-mono text-green-400">
                        {sym}{(avail / 100).toFixed(2)}
                      </td>
                      <td className="px-5 py-3 text-right font-mono text-yellow-400">
                        {held > 0 ? `${sym}${(held / 100).toFixed(2)}` : '—'}
                      </td>
                      <td className="px-5 py-3 text-right font-mono text-gray-300">
                        {sym}{(deposited / 100).toFixed(2)}
                      </td>
                      <td className={`px-5 py-3 text-right font-mono font-bold ${net >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {net >= 0 ? '+' : ''}{sym}{(net / 100).toFixed(2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pending cashout notice */}
        {pendingCashoutAmount > 0 && (
          <div className="bg-yellow-950/40 border border-yellow-800 rounded-xl p-4">
            <p className="text-yellow-200 text-sm">
              Cashout awaiting payout: {(pendingCashoutAmount / 100).toFixed(2)} — tokens held, pending admin settlement.
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-gray-900 rounded-xl p-6">
            <h2 className="text-lg font-semibold mb-1">Add funds</h2>
            <p className="text-gray-400 text-sm mb-4">
              Select currency and amount. Funds are available instantly for buy-in.
            </p>
            <PurchaseForm />
          </div>
          <div className="bg-gray-900 rounded-xl p-6">
            <h2 className="text-lg font-semibold mb-2">Cash out</h2>
            {walletBalances.length === 0 ? (
              <p className="text-gray-500 text-sm">No balance to cash out.</p>
            ) : (
              <>
                <div className="space-y-1 mb-4">
                  {walletBalances.map((b) => (
                    <p key={b.currencySymbol} className="text-gray-300 text-sm">
                      {b.currencySymbol}: <span className="font-mono font-bold">{b.currencySymbol}{(b.balanceCents / 100).toFixed(2)}</span>
                    </p>
                  ))}
                </div>
                <p className="text-gray-400 text-xs mb-4">
                  Tokens are held immediately; payment processed after admin approval.
                </p>
                <CashoutForm maxTokens={walletBalances.reduce((s, b) => s + b.balanceCents, 0)} />
              </>
            )}
          </div>
        </div>

        {/* Hand history */}
        <Section title={`Hand history (${handResultRows.length} hands${tableNet !== 0 ? ` · net: ${tableNet >= 0 ? '+' : ''}${(tableNet / 100).toFixed(2)}` : ''})`}>
          {handResultRows.length === 0 ? (
            <p className="text-gray-500 text-sm">No hands played yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 border-b border-gray-800">
                  <th className="text-left py-2">Date</th>
                  <th className="text-right py-2">Net</th>
                  <th className="text-right py-2">Won</th>
                  <th className="text-right py-2">Contributed</th>
                  <th className="text-right py-2">Hand</th>
                </tr>
              </thead>
              <tbody>
                {handResultRows.slice(-50).reverse().map((r) => (
                  <tr key={r.id} className="border-b border-gray-800/50">
                    <td className="py-2 text-gray-300">{r.createdAt.toLocaleDateString()}</td>
                    <td className={`py-2 text-right font-mono ${r.netMinor >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {r.netMinor >= 0 ? '+' : ''}{(r.netMinor / 100).toFixed(2)}
                    </td>
                    <td className="py-2 text-right font-mono">{(r.wonMinor / 100).toFixed(2)}</td>
                    <td className="py-2 text-right font-mono">{(r.contributedMinor / 100).toFixed(2)}</td>
                    <td className="py-2 text-right text-gray-400">{r.handRank ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-900 rounded-xl p-6">
      <h2 className="text-lg font-semibold mb-4">{title}</h2>
      {children}
    </div>
  );
}
