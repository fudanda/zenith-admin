import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from '../../db';
import { workflowSavedViews } from '../../db/schema';
import { HTTPException } from 'hono/http-exception';
import { currentUser } from '../../lib/context';
import { getCreateTenantId, tenantCondition } from '../../lib/tenant';
import { buildWhere } from '../../lib/where-helpers';
import { formatTimestamps } from '../../lib/datetime';
import { clearDefaultFlag } from '../../lib/default-flag';
import type { QueryOutputOf } from '@arcbase/shared/core';
import { workflowSavedViewContract, type WorkflowSavedView, type CreateWorkflowSavedViewInput, type UpdateWorkflowSavedViewInput } from '@arcbase/shared/workflow';

type Row = typeof workflowSavedViews.$inferSelect;

/** 默认标记的归属范围：同一用户同一页面内至多一个默认视图 */
function viewDefaultScope(userId: number, pageKey: string) {
  return and(eq(workflowSavedViews.userId, userId), eq(workflowSavedViews.pageKey, pageKey));
}

function mapView(row: Row): WorkflowSavedView {
  return {
    id: row.id,
    userId: row.userId,
    pageKey: row.pageKey,
    name: row.name,
    filters: (row.filters ?? {}) as Record<string, unknown>,
    isDefault: row.isDefault,
    sort: row.sort,
    ...formatTimestamps(row),
  };
}

async function ensureOwn(id: number): Promise<Row> {
  const user = currentUser();
  const [row] = await db.select().from(workflowSavedViews)
    .where(buildWhere(eq(workflowSavedViews.id, id), tenantCondition(workflowSavedViews, user))).limit(1);
  if (!row || row.userId !== user.userId) throw new HTTPException(404, { message: '视图不存在' });
  return row;
}

export async function listSavedViews({ pageKey }: QueryOutputOf<typeof workflowSavedViewContract.list>): Promise<WorkflowSavedView[]> {
  const user = currentUser();
  const rows = await db.select().from(workflowSavedViews)
    .where(and(eq(workflowSavedViews.userId, user.userId), eq(workflowSavedViews.pageKey, pageKey)))
    .orderBy(asc(workflowSavedViews.sort), desc(workflowSavedViews.id));
  return rows.map(mapView);
}

/** 当前用户自己的视图；不存在或非本人 404 */
export async function getSavedView(id: number): Promise<WorkflowSavedView> {
  return mapView(await ensureOwn(id));
}

export async function createSavedView(input: CreateWorkflowSavedViewInput): Promise<WorkflowSavedView> {
  const user = currentUser();
  const row = await db.transaction(async (tx) => {
    if (input.isDefault) await clearDefaultFlag(tx, workflowSavedViews, viewDefaultScope(user.userId, input.pageKey));
    const [r] = await tx.insert(workflowSavedViews).values({
      userId: user.userId,
      pageKey: input.pageKey,
      name: input.name,
      filters: input.filters ?? {},
      isDefault: input.isDefault ?? false,
      sort: input.sort ?? 0,
      tenantId: getCreateTenantId(user),
    }).returning();
    return r;
  });
  return mapView(row);
}

export async function updateSavedView(id: number, input: UpdateWorkflowSavedViewInput): Promise<WorkflowSavedView> {
  const existing = await ensureOwn(id);
  const row = await db.transaction(async (tx) => {
    if (input.isDefault) await clearDefaultFlag(tx, workflowSavedViews, viewDefaultScope(existing.userId, existing.pageKey));
    const patch: Partial<typeof workflowSavedViews.$inferInsert> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.filters !== undefined) patch.filters = input.filters;
    if (input.isDefault !== undefined) patch.isDefault = input.isDefault;
    if (input.sort !== undefined) patch.sort = input.sort;
    const [r] = await tx.update(workflowSavedViews).set(patch).where(eq(workflowSavedViews.id, id)).returning();
    return r;
  });
  return mapView(row);
}

export async function deleteSavedView(id: number): Promise<void> {
  await ensureOwn(id);
  await db.delete(workflowSavedViews).where(eq(workflowSavedViews.id, id));
}
