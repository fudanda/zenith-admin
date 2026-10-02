import { and, eq, inArray, sql } from 'drizzle-orm';
import { mpMaterialContract, mpMaterialSchema, type MpMaterialType } from '@arcbase/shared/mp';
import { db } from '../../db';
import { mpMaterials } from '../../db/schema';
import { defineCrudService } from '../../lib/crud-service';
import { entityMapper } from '../../lib/entity-map';
import { currentCreateTenantId } from '../../lib/tenant';
import { keywordCondition } from '../../lib/where-helpers';
import { ensureMpAccountExists } from './mp-account.service';
import { batchGetWechatMaterials, deleteWechatMaterial, uploadWechatMaterial } from '../../lib/wechat';
import { mapWechatError } from '../../lib/wechat-error';
import logger from '../../lib/logger';

export const mapMpMaterial = entityMapper(mpMaterialSchema);

const mpMaterialCrud = defineCrudService(mpMaterialContract, {
  table: mpMaterials,
  map: mapMpMaterial,
  notFound: '素材不存在',
  tenant: true,
  list: (q) => ({
    where: [
      eq(mpMaterials.accountId, q.accountId),
      q.type ? eq(mpMaterials.type, q.type) : undefined,
      keywordCondition(q.keyword, [mpMaterials.name], 'ilike'),
    ],
    orderBy: [mpMaterials.id],
  }),
  create: {
    before: async (data) => {
      await ensureMpAccountExists(data.accountId);
    },
  },
  update: {
    toRow: (data) => ({ name: data.name }),
  },
  remove: {
    before: async (row) => {
      if (!row.wechatMediaId) return;
      try {
        const account = await ensureMpAccountExists(row.accountId);
        await deleteWechatMaterial(account, row.wechatMediaId);
      } catch (err) {
        logger.warn(`[mp-material] 微信端素材删除失败（已忽略）: ${(err as Error).message}`);
      }
    },
  },
});

export async function listMpMaterials(q: Parameters<typeof mpMaterialCrud.list>[0]) {
  await ensureMpAccountExists(q.accountId);
  return mpMaterialCrud.list(q);
}

export const mpMaterialService = { ...mpMaterialCrud, list: listMpMaterials };

export const {
  ensure: ensureMpMaterialExists,
  create: createMpMaterial,
  update: updateMpMaterial,
  remove: deleteMpMaterial,
} = mpMaterialCrud;

export const getMpMaterialBeforeAudit = mpMaterialCrud.get;

/** 上传二进制素材到微信永久素材库，并登记本地。 */
export async function uploadMpMaterial(
  accountId: number,
  type: MpMaterialType,
  file: Blob,
  filename: string,
  name: string,
  videoMeta?: { title: string; introduction: string },
) {
  const account = await ensureMpAccountExists(accountId);
  let result;
  try {
    result = await uploadWechatMaterial(account, type, file, filename, videoMeta);
  } catch (err) {
    return mapWechatError(err);
  }
  const [row] = await db.insert(mpMaterials).values({
    accountId,
    type,
    name: name || filename,
    wechatMediaId: result.mediaId,
    url: result.url,
    fileSize: file.size,
    tenantId: currentCreateTenantId(),
  }).returning();
  return mapMpMaterial(row);
}

export async function syncMpMaterials(accountId: number): Promise<{ success: boolean; created: number; updated: number; total: number }> {
  const account = await ensureMpAccountExists(accountId);
  const tenantId = currentCreateTenantId();
  const types = ['image', 'voice', 'video'] as const;
  const PAGE = 20;
  let created = 0;
  let updated = 0;
  let total = 0;
  try {
    for (const type of types) {
      let offset = 0;
      for (;;) {
        const { total: typeTotal, items } = await batchGetWechatMaterials(account, type, offset, PAGE);
        total += items.length;
        // 页内按 media_id 去重，避免同一批 upsert 两次命中同一行
        const uniqueItems = [...new Map(items.filter((i) => i.media_id).map((i) => [i.media_id, i])).values()];
        if (uniqueItems.length > 0) {
          const mediaIds = uniqueItems.map((i) => i.media_id);
          const existing = await db.select({ wechatMediaId: mpMaterials.wechatMediaId }).from(mpMaterials)
            .where(and(eq(mpMaterials.accountId, accountId), inArray(mpMaterials.wechatMediaId, mediaIds)));
          const existingSet = new Set(existing.map((r) => r.wechatMediaId));
          // 单条多行 upsert：以 (accountId, wechatMediaId) 部分唯一索引为冲突目标，替代逐条查重+写入
          await db.insert(mpMaterials)
            .values(uniqueItems.map((item) => ({
              accountId,
              type,
              name: item.name || '未命名素材',
              wechatMediaId: item.media_id,
              url: item.url ?? null,
              tenantId,
            })))
            .onConflictDoUpdate({
              target: [mpMaterials.accountId, mpMaterials.wechatMediaId],
              targetWhere: sql`${mpMaterials.wechatMediaId} is not null`,
              set: { name: sql`excluded.name`, url: sql`excluded.url` },
            });
          const newCount = mediaIds.filter((id) => !existingSet.has(id)).length;
          created += newCount;
          updated += mediaIds.length - newCount;
        }
        offset += items.length;
        if (items.length < PAGE || offset >= typeTotal) break;
      }
    }
  } catch (err) {
    mapWechatError(err);
  }
  return { success: true, created, updated, total };
}
