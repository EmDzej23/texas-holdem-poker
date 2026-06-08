/**
 * PgTableStore — implements the shared TableStore interface against Postgres.
 *
 * The interface (from packages/shared/src/protocol.ts):
 *   getTable(tableId): Promise<TableRecord | undefined>
 *   setTable(record): Promise<void>
 *   deleteTable(tableId): Promise<void>
 *   listTables(): Promise<TableRecord[]>
 *
 * This is the DURABLE backing for the ephemeral live-table snapshot.
 * Redis (when present) caches the same data for sub-millisecond reads;
 * on cache miss or process restart, rebuild from here.
 *
 * The JSON blobs (handState, seats, config) are opaque to the DB layer —
 * the WS service owns their shape.
 */

import { eq } from 'drizzle-orm';
import type { TableStore, TableRecord } from '@poker/shared';
import { tableRecords } from './schema/tables.js';
import type { Db } from './client.js';

function rowToRecord(row: typeof tableRecords.$inferSelect): TableRecord {
  return {
    tableId: row.tableId,
    ...(row.handStateJson !== null && { handState: row.handStateJson }),
    seats: row.seatsJson,
    shuffleIndex: row.shuffleIndex,
    config: row.configJson,
    createdAt: row.createdAt.getTime(),
    lastActivityAt: row.lastActivityAt.getTime(),
  };
}

export function createPgTableStore(db: Db): TableStore {
  return {
    async getTable(tableId: string): Promise<TableRecord | undefined> {
      const rows = await db
        .select()
        .from(tableRecords)
        .where(eq(tableRecords.tableId, tableId))
        .limit(1);
      return rows[0] ? rowToRecord(rows[0]) : undefined;
    },

    async setTable(record: TableRecord): Promise<void> {
      await db
        .insert(tableRecords)
        .values({
          tableId: record.tableId,
          handStateJson: record.handState ?? null,
          seatsJson: record.seats,
          shuffleIndex: record.shuffleIndex,
          configJson: record.config,
          createdAt: new Date(record.createdAt),
          lastActivityAt: new Date(record.lastActivityAt),
        })
        .onConflictDoUpdate({
          target: tableRecords.tableId,
          set: {
            handStateJson: record.handState ?? null,
            seatsJson: record.seats,
            shuffleIndex: record.shuffleIndex,
            configJson: record.config,
            lastActivityAt: new Date(record.lastActivityAt),
          },
        });
    },

    async deleteTable(tableId: string): Promise<void> {
      await db.delete(tableRecords).where(eq(tableRecords.tableId, tableId));
    },

    async listTables(): Promise<TableRecord[]> {
      const rows = await db.select().from(tableRecords);
      return rows.map(rowToRecord);
    },
  };
}
