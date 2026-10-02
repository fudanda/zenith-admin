import { eq, and, ne, desc } from 'drizzle-orm';
import { ratePlanContract, ratePlanSchema } from '@arcbase/shared/open-platform';
import { clearDefaultFlag } from '../../lib/default-flag';
import { db } from '../../db';
import { ratePlans, oauth2Clients } from '../../db/schema';
import type { RatePlanRow } from '../../db/schema';
import type { DbExecutor } from '../../db/types';
import { HTTPException } from 'hono/http-exception';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { keywordCondition } from '../../lib/where-helpers';
import type { CreateRatePlanInput, UpdateRatePlanInput } from '@arcbase/shared/open-platform';
import { defineCrudService } from '../../lib/crud-service';
import { entityMapper } from '../../lib/entity-map';

export const mapRatePlan = entityMapper(ratePlanSchema);

export const ratePlanService = defineCrudService(ratePlanContract, {
  table: ratePlans,
  map: mapRatePlan,
  notFound: '限流套餐不存在',
  list: (q) => ({
    where: [
      keywordCondition(q.keyword, [ratePlans.code, ratePlans.name], 'ilike'),
      q.status ? eq(ratePlans.status, q.status) : undefined,
    ],
    orderBy: [desc(ratePlans.isDefault), desc(ratePlans.createdAt)],
  }),
  remove: {
    before: async (existing) => {
      if (existing.isDefault) {
        throw new HTTPException(400, { message: '默认套餐不可删除，请先将其他套餐设为默认' });
      }
      const usedBy = await db.$count(oauth2Clients, eq(oauth2Clients.ratePlanId, existing.id));
      if (usedBy > 0) {
        throw new HTTPException(400, { message: `该套餐已被 ${usedBy} 个应用绑定，无法删除` });
      }
    },
  },
});

export const { list: listRatePlans, get: getRatePlan, remove: deleteRatePlan } = ratePlanService;

/** 全部启用的套餐（供应用配置下拉，无分页） */
export async function listEnabledRatePlans() {
  const rows = await db.select().from(ratePlans)
    .where(eq(ratePlans.status, 'enabled'))
    .orderBy(desc(ratePlans.isDefault), ratePlans.qpsLimit);
  return rows.map(mapRatePlan);
}

export const getRatePlanBeforeAudit = getRatePlan;

/** 原始行：供网关限流中间件读取配额（不映射为 DTO） */
export async function getRatePlanRowById(id: number): Promise<RatePlanRow | null> {
  const [row] = await db.select().from(ratePlans).where(eq(ratePlans.id, id)).limit(1);
  return row ?? null;
}

/** 默认套餐：应用未绑定套餐时回退使用 */
export async function getDefaultRatePlanRow(): Promise<RatePlanRow | null> {
  const [row] = await db.select().from(ratePlans)
    .where(and(eq(ratePlans.isDefault, true), eq(ratePlans.status, 'enabled')))
    .limit(1);
  return row ?? null;
}

/** 将除 keepId 外的所有套餐 isDefault 置为 false（套餐是平台级资源，默认全表唯一） */
async function clearOtherDefaults(executor: DbExecutor, keepId?: number) {
  const cond = keepId
    ? and(eq(ratePlans.isDefault, true), ne(ratePlans.id, keepId))
    : eq(ratePlans.isDefault, true);
  await clearDefaultFlag(executor, ratePlans, cond);
}

export async function createRatePlan(input: CreateRatePlanInput) {
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx.insert(ratePlans).values({
        code: input.code.trim(),
        name: input.name.trim(),
        description: input.description,
        qpsLimit: input.qpsLimit ?? 10,
        dailyQuota: input.dailyQuota ?? 0,
        monthlyQuota: input.monthlyQuota ?? 0,
        isDefault: input.isDefault ?? false,
        status: input.status ?? 'enabled',
      }).returning();
      if (row.isDefault) await clearOtherDefaults(tx, row.id);
      return mapRatePlan(row);
    });
  } catch (err) {
    rethrowPgUniqueViolation(err, '套餐编码已存在');
    throw err;
  }
}

export async function updateRatePlan(id: number, input: UpdateRatePlanInput) {
  await getRatePlan(id);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx.update(ratePlans).set({
        name: input.name?.trim(),
        description: input.description,
        qpsLimit: input.qpsLimit,
        dailyQuota: input.dailyQuota,
        monthlyQuota: input.monthlyQuota,
        isDefault: input.isDefault,
        status: input.status,
      }).where(eq(ratePlans.id, id)).returning();
      if (row.isDefault) await clearOtherDefaults(tx, row.id);
      return mapRatePlan(row);
    });
  } catch (err) {
    rethrowPgUniqueViolation(err, '套餐编码已存在');
    throw err;
  }
}
