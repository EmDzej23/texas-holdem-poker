/**
 * Admin authentication — separate from player auth (better-auth).
 * Uses bcrypt-verified passwords from the admins table + signed JWT cookie.
 */
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { getDb, admins } from '@poker/db';

const COOKIE = 'admin_token';
const ALG = 'HS256';

function getSecret(): Uint8Array {
  const s = process.env['ADMIN_JWT_SECRET'];
  if (!s) throw new Error('ADMIN_JWT_SECRET env var is not set');
  return new TextEncoder().encode(s);
}

export interface AdminClaims {
  sub: string;  // admin id
  username: string;
}

export async function signAdminIn(username: string, password: string): Promise<boolean> {
  const db = getDb();
  const rows = await db.select().from(admins).where(eq(admins.username, username)).limit(1);
  const admin = rows[0];
  if (!admin) return false;

  const ok = await bcrypt.compare(password, admin.passwordHash);
  if (!ok) return false;

  const token = await new SignJWT({ sub: admin.id, username: admin.username })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime('8h')
    .sign(getSecret());

  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/admin',
    maxAge: 60 * 60 * 8,
  });

  return true;
}

export async function getAdminSession(): Promise<AdminClaims | null> {
  try {
    const jar = await cookies();
    const token = jar.get(COOKIE)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, getSecret());
    return { sub: payload['sub'] as string, username: payload['username'] as string };
  } catch {
    return null;
  }
}

export async function clearAdminSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}
