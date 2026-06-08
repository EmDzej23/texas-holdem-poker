import { NextResponse } from 'next/server';
import { signAdminIn, clearAdminSession } from '@/lib/admin-auth';

export async function POST(req: Request) {
  const body = await req.json() as { username?: unknown; password?: unknown };
  if (typeof body.username !== 'string' || typeof body.password !== 'string') {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const ok = await signAdminIn(body.username, body.password);
  if (!ok) return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });

  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  await clearAdminSession();
  return NextResponse.json({ ok: true });
}
