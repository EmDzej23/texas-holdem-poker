'use client';

import { useParams } from 'next/navigation';
import { useSession } from '@/lib/auth-client';
import { PokerTable } from '@/components/PokerTable';

export default function TablePage() {
  const params = useParams<{ id: string }>();
  const { data: session, isPending } = useSession();
  const playerId = session?.user?.id ?? null;

  return <PokerTable tableId={params.id} playerId={playerId} sessionLoading={isPending} />;
}
