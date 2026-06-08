import { NextResponse } from 'next/server';
import { verifyShuffledDeck } from '@poker/engine';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const serverSeed = url.searchParams.get('serverSeed') ?? '';
  const clientSeed = url.searchParams.get('clientSeed') ?? '';
  const shuffleIndex = Number(url.searchParams.get('shuffleIndex') ?? '0');
  const publishedHash = url.searchParams.get('publishedHash') ?? '';

  if (!serverSeed || !clientSeed || !publishedHash) {
    return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
  }

  const result = verifyShuffledDeck(serverSeed, clientSeed, shuffleIndex, publishedHash);
  return NextResponse.json(result);
}
