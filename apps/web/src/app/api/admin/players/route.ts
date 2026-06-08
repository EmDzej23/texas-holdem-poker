import { NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/admin-auth';
import { getDb, createAdminRepository } from '@poker/db';

export async function GET() {
  if (!await getAdminSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const summaries = await createAdminRepository(getDb()).listPlayerSummaries();
  return NextResponse.json(summaries);
}
