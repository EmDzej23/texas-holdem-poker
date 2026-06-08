import { pgTable, text, timestamp, uuid, index } from 'drizzle-orm/pg-core';

export const admins = pgTable('admins', {
  id: uuid('id').defaultRandom().primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const adminAuditLog = pgTable(
  'admin_audit_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    adminId: uuid('admin_id').notNull().references(() => admins.id),
    action: text('action').notNull(),
    resourceType: text('resource_type'),
    resourceId: text('resource_id'),
    detailsJson: text('details_json'),
    ip: text('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('admin_audit_log_admin_idx').on(t.adminId),
    index('admin_audit_log_created_idx').on(t.createdAt),
  ],
);

export type AdminRow = typeof admins.$inferSelect;
export type AdminAuditLogRow = typeof adminAuditLog.$inferSelect;
