/**
 * Admin authentication — separate from player auth (better-auth).
 * Uses bcrypt-verified passwords from the admins table + signed JWT cookie.
 * Additionally, players whose email is in the admin_email_grants DB table are
 * granted admin access via their existing better-auth session (no password needed).
 */
import { SignJWT, jwtVerify } from 'jose';
import { cookies, headers } from 'next/headers';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { getDb, admins, adminEmailGrants } from '@poker/db';
import { auth } from './auth';

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
  // 1. Check dedicated admin JWT cookie (username/password login)
  try {
    const jar = await cookies();
    const token = jar.get(COOKIE)?.value;
    if (token) {
      const { payload } = await jwtVerify(token, getSecret());
      return { sub: payload['sub'] as string, username: payload['username'] as string };
    }
  } catch {
    // invalid/expired token — fall through
  }

  // 2. Accept better-auth player session if email is in admin_email_grants table
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (session?.user?.email) {
      const db = getDb();
      const grant = await db
        .select()
        .from(adminEmailGrants)
        .where(eq(adminEmailGrants.email, session.user.email.toLowerCase()))
        .limit(1);
      if (grant.length > 0) {
        return { sub: session.user.id, username: session.user.email };
      }
    }
  } catch {
    // no session or DB error — not an admin
  }

  return null;
}

export async function clearAdminSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}
