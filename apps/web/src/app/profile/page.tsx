import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { getDb, createPgLedgerStore, createSettlementRepository } from '@poker/db';
import { LedgerService } from '@poker/engine';
import { eq } from 'drizzle-orm';
import { handResults, sessions } from '@poker/db';
import { formatMoney, formatTokens } from '@/lib/format';
import Link from 'next/link';
import { PurchaseForm } from '@/components/PurchaseForm';
import { CashoutForm } from '@/components/CashoutForm';

export default async function ProfilePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/login');

  const playerId = session.user.id;
  const db = getDb();
  const ledger = new LedgerService(createPgLedgerStore(db));
  const settlement = createSettlementRepository(db);

  const [
    walletBalance,
    heldBalance,
    purchases,
    cashouts,
    handResultRows,
    sessionRows,
  ] = await Promise.all([
    ledger.getBalance({ type: 'player_wallet', ownerId: playerId }),
    ledger.getBalance({ type: 'player_cashout_hold', ownerId: playerId }),
    settlement.getPurchasesForPlayer(playerId),
    settlement.getCashoutsForPlayer(playerId),
    db.select().from(handResults).where(eq(handResults.playerId, playerId)).orderBy(handResults.createdAt),
    db.select().from(sessions).where(eq(sessions.playerId, playerId)).orderBy(sessions.joinedAt),
  ]);

  const totalDeposited = purchases.filter((p) => p.status === 'approved').reduce((s, p) => s + p.realMoneyMinor, 0);
  const pendingDeposits = purchases.filter((p) => p.status === 'pending').reduce((s, p) => s + p.realMoneyMinor, 0);
  const totalCashedOut = cashouts.filter((c) => c.status === 'approved').reduce((s, c) => s + c.realMoneyMinor, 0);
  const pendingCashoutAmount = cashouts.filter((c) => c.status === 'pending').reduce((s, c) => s + c.realMoneyMinor, 0);
  const tableNet = handResultRows.reduce((s, r) => s + r.netMinor, 0);
  const netResult = (walletBalance + heldBalance + totalCashedOut) - totalDeposited;

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

        {/* Balance summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Wallet" value={formatTokens(walletBalance)} sub={formatMoney(walletBalance)} />
          <StatCard label="Held (pending cashout)" value={formatTokens(heldBalance)} sub={formatMoney(heldBalance)} warn={heldBalance > 0} />
          <StatCard label="Total deposited" value={formatMoney(totalDeposited)} sub={`net spent: ${formatMoney(totalDeposited - totalCashedOut)}`} />
          <StatCard
            label="Net result"
            value={formatMoney(Math.abs(netResult))}
            sub={`table net: ${formatMoney(tableNet)}`}
            positive={netResult >= 0}
            negative={netResult < 0}
          />
        </div>

        {/* Due / Pending */}
        {(pendingDeposits > 0 || pendingCashoutAmount > 0) && (
          <div className="bg-yellow-950/40 border border-yellow-800 rounded-xl p-4 space-y-2">
            <h3 className="text-yellow-300 font-semibold text-sm uppercase tracking-wide">Pending</h3>
            {pendingDeposits > 0 && (
              <p className="text-yellow-200 text-sm">
                Token purchase pending: {formatMoney(pendingDeposits)} due in real life — awaiting admin approval.
              </p>
            )}
            {pendingCashoutAmount > 0 && (
              <p className="text-yellow-200 text-sm">
                Cashout awaiting payout: {formatMoney(pendingCashoutAmount)} — tokens held, pending admin settlement.
              </p>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-gray-900 rounded-xl p-6">
            <h2 className="text-lg font-semibold mb-4">Buy tokens</h2>
            <p className="text-gray-400 text-sm mb-4">
              1 token = $0.01 · you'll owe the equivalent in real money · tokens credited after admin approval.
            </p>
            <PurchaseForm />
          </div>
          <div className="bg-gray-900 rounded-xl p-6">
            <h2 className="text-lg font-semibold mb-4">Cash out</h2>
            <p className="text-gray-400 text-sm mb-2">
              Available: {formatTokens(walletBalance)} ({formatMoney(walletBalance)})
            </p>
            <p className="text-gray-400 text-sm mb-4">
              Tokens are held immediately; real money paid after admin approval.
            </p>
            <CashoutForm maxTokens={walletBalance} />
          </div>
        </div>

        {/* History tabs */}
        <div className="space-y-6">
          <Section title="Token purchases">
            {purchases.length === 0 ? (
              <p className="text-gray-500 text-sm">No purchases yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-800">
                    <th className="text-left py-2">Date</th>
                    <th className="text-right py-2">Tokens</th>
                    <th className="text-right py-2">Real money</th>
                    <th className="text-right py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {purchases.map((p) => (
                    <tr key={p.id} className="border-b border-gray-800/50">
                      <td className="py-2 text-gray-300">{p.createdAt.toLocaleDateString()}</td>
                      <td className="py-2 text-right">{formatTokens(p.tokenAmount)}</td>
                      <td className="py-2 text-right">{formatMoney(p.realMoneyMinor)}</td>
                      <td className="py-2 text-right"><StatusBadge status={p.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section title="Cashouts">
            {cashouts.length === 0 ? (
              <p className="text-gray-500 text-sm">No cashouts yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-800">
                    <th className="text-left py-2">Date</th>
                    <th className="text-right py-2">Tokens</th>
                    <th className="text-right py-2">Real money</th>
                    <th className="text-right py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {cashouts.map((c) => (
                    <tr key={c.id} className="border-b border-gray-800/50">
                      <td className="py-2 text-gray-300">{c.createdAt.toLocaleDateString()}</td>
                      <td className="py-2 text-right">{formatTokens(c.tokenAmount)}</td>
                      <td className="py-2 text-right">{formatMoney(c.realMoneyMinor)}</td>
                      <td className="py-2 text-right"><StatusBadge status={c.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section title={`Hand history (${handResultRows.length} hands)`}>
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
                      <td className={`py-2 text-right ${r.netMinor >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {r.netMinor >= 0 ? '+' : ''}{formatMoney(r.netMinor)}
                      </td>
                      <td className="py-2 text-right">{formatMoney(r.wonMinor)}</td>
                      <td className="py-2 text-right">{formatMoney(r.contributedMinor)}</td>
                      <td className="py-2 text-right text-gray-400">{r.handRank ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label, value, sub, warn, positive, negative,
}: {
  label: string;
  value: string;
  sub?: string;
  warn?: boolean;
  positive?: boolean;
  negative?: boolean;
}) {
  return (
    <div className={`rounded-xl p-4 ${warn ? 'bg-yellow-950/30 border border-yellow-800' : 'bg-gray-900 border border-gray-800'}`}>
      <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-xl font-bold ${positive ? 'text-green-400' : negative ? 'text-red-400' : 'text-white'}`}>
        {value}
      </p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
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

function StatusBadge({ status }: { status: string }) {
  const color =
    status === 'approved' ? 'text-green-400 bg-green-950/50' :
    status === 'rejected' ? 'text-red-400 bg-red-950/50' :
    status === 'cancelled' ? 'text-gray-400 bg-gray-800' :
    'text-yellow-400 bg-yellow-950/50';
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${color}`}>
      {status}
    </span>
  );
}
