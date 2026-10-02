import { index, integer, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import type { CmsTelemetryBusinessPayload } from '@arcbase/shared/cms';
import { idColumn } from './common';
import { cmsSites } from './cms';

/** Delivery diagnostics are distinct from business events and never counted as PV. */
export const cmsTelemetryReceipts = pgTable('cms_telemetry_receipts', {
  id: idColumn(), siteId: integer().notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  accepted: integer().notNull().default(0), rejected: integer().notNull().default(0), duplicates: integer().notNull().default(0),
  reason: varchar({ length: 64 }), createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('cms_telemetry_receipts_site_created_idx').on(t.siteId, t.createdAt)]);

/** Persisted in the business transaction; worker delivery is retryable and idempotent. */
export const cmsTelemetryOutbox = pgTable('cms_telemetry_outbox', {
  id: idColumn(), siteId: integer().notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  eventId: uuid().notNull().unique('cms_telemetry_outbox_event_id_unique'),
  payload: jsonb().$type<CmsTelemetryBusinessPayload>().notNull(), attempts: integer().notNull().default(0),
  lastError: text(), deliveredAt: timestamp({ withTimezone: true }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('cms_telemetry_outbox_pending_idx').on(t.deliveredAt, t.id)]);
