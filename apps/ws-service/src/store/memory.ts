/**
 * In-memory TableStore — suitable for single-process dev/test.
 *
 * TODO (production): replace with RedisTableStore that uses:
 *   - HSET/HGET for table records (atomic WATCH/MULTI/EXEC for mutations)
 *   - PUBLISH/SUBSCRIBE for cross-node broadcasts
 *   - TTL-based cleanup of stale tables
 */

import type { TableRecord, TableStore } from '@poker/shared';

export function createMemoryTableStore(): TableStore {
  const tables = new Map<string, TableRecord>();

  return {
    async getTable(tableId: string): Promise<TableRecord | undefined> {
      return tables.get(tableId);
    },

    async setTable(record: TableRecord): Promise<void> {
      tables.set(record.tableId, record);
    },

    async deleteTable(tableId: string): Promise<void> {
      tables.delete(tableId);
    },

    async listTables(): Promise<TableRecord[]> {
      return [...tables.values()];
    },
  };
}
