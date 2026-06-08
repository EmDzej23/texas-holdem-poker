import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema/index.js';

export type Db = ReturnType<typeof drizzle<typeof schema>>;

let _db: Db | undefined;

/**
 * Create (or return cached) Drizzle DB instance.
 * Call once at app startup with the DATABASE_URL.
 *
 * For Next.js: import { getDb } from '@poker/db' in server components / route handlers.
 * For ws-service: call createDb(url) at process startup.
 */
export function createDb(url: string): Db {
  const client = postgres(url, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  return drizzle(client, { schema });
}

/** Singleton for Next.js (module-level cache survives across requests). */
export function getDb(): Db {
  if (!_db) {
    const url = process.env['DATABASE_URL'];
    if (!url) throw new Error('DATABASE_URL env var is not set');
    _db = createDb(url);
  }
  return _db;
}
