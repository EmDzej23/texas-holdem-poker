import Link from 'next/link';

export default function LobbyPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-8 p-8">
      <div className="text-center">
        <h1 className="text-5xl font-bold text-white mb-2">♠ Texas Hold'em</h1>
        <p className="text-gray-400">Multiplayer cash game</p>
      </div>

      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-sm">
        <h2 className="text-white font-semibold mb-4">Available Tables</h2>
        <div className="space-y-3">
          {['table-1'].map((tid) => (
            <div key={tid} className="flex items-center justify-between bg-gray-800 rounded-xl p-4">
              <div>
                <div className="text-white font-medium">Table {tid}</div>
                <div className="text-gray-400 text-sm">$0.50 / $1.00 · 6-max</div>
              </div>
              <Link
                href={`/table/${tid}`}
                className="px-4 py-2 bg-yellow-500 hover:bg-yellow-400 text-black font-bold rounded-lg text-sm transition-colors"
              >
                Join
              </Link>
            </div>
          ))}
        </div>
      </div>

      <p className="text-gray-600 text-xs text-center max-w-sm">
        TODO seams: KYC/AML verification required before sitting at real-money tables.
        Regulatory compliance, geo-blocking, and payment processing are not implemented.
      </p>
    </div>
  );
}
