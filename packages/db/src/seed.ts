/**
 * Seed script — creates a default admin user and the default table record.
 *
 * Usage:
 *   DATABASE_URL=postgres://... ADMIN_PASSWORD=secret pnpm --filter @poker/db db:seed
 *
 * Safe to run multiple times (upsert semantics).
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import bcrypt from 'bcryptjs';
import { admins, tableRecords } from './schema/index.js';
import { eq } from 'drizzle-orm';

const url = process.env['DATABASE_URL'];
if (!url) { console.error('DATABASE_URL not set'); process.exit(1); }

const adminPassword = process.env['ADMIN_PASSWORD'] ?? 'changeme';
const client = postgres(url, { max: 1 });
const db = drizzle(client);

// Upsert admin
const hash = await bcrypt.hash(adminPassword, 12);
await db
  .insert(admins)
  .values({ username: 'admin', passwordHash: hash })
  .onConflictDoUpdate({ target: admins.username, set: { passwordHash: hash } });

console.log(`[seed] Admin user "admin" created (password: ${adminPassword})`);

// Seed default table record so the WS service finds it on startup
const defaultConfig = {
  tableId: 'table-1',
  smallBlindCents: 50,
  bigBlindCents: 100,
  minBuyInCents: 4000,
  maxBuyInCents: 20000,
  maxSeats: 6,
  rakePercent: 5,
  rakeCapCents: 300,
  turnTimeoutMs: 30000,
};

await db
  .insert(tableRecords)
  .values({
    tableId: 'table-1',
    seatsJson: '[]',
    shuffleIndex: 0,
    configJson: JSON.stringify(defaultConfig),
  })
  .onConflictDoNothing();

console.log('[seed] Default table-1 record ensured.');
await client.end();
