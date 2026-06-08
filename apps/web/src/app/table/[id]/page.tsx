import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import dynamic from 'next/dynamic';

const PokerTable = dynamic(
  () => import('@/components/PokerTable').then((m) => m.PokerTable),
  {
    ssr: false,
    loading: () => (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <span className="text-gray-400 text-sm">Loading table…</span>
      </div>
    ),
  },
);

export default async function TablePage({ params }: { params: { id: string } }) {
  const session = await auth.api.getSession({ headers: headers() });
  const playerId = session?.user?.id ?? null;
  const displayName = session?.user?.name ?? null;

  return (
    <PokerTable
      tableId={params.id}
      playerId={playerId}
      displayName={displayName}
      sessionLoading={false}
    />
  );
}
