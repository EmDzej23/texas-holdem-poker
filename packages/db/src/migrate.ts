/**
 * Migration runner — applies pending SQL migrations from the migrations/ directory.
 *
 * Usage:
 *   DATABASE_URL=postgres://... pnpm --filter @poker/db db:migrate
 *
 * This script uses drizzle-kit's push logic (reads migrations/ folder).
 * For CI/production, prefer `drizzle-kit migrate` via drizzle.config.ts.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const url = process.env['DATABASE_URL'];
if (!url) {
  console.error('DATABASE_URL env var is not set');
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = join(__dirname, '..', 'migrations');

const client = postgres(url, { max: 1 });
const db = drizzle(client);

console.log('[migrate] Applying migrations from', migrationsFolder);
await migrate(db, { migrationsFolder });
console.log('[migrate] Done.');
await client.end();
