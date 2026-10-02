import { and, eq, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { mpTagContract, mpTagSchema } from '@arcbase/shared/mp';
import { db } from '../../db';
import { mpTags } from '../../db/schema';
import { defineCrudService } from '../../lib/crud-service';
import { entityMapper } from '../../lib/entity-map';
import { currentCreateTenantId } from '../../lib/tenant';
import { keywordCondition } from '../../lib/where-helpers';
import { ensureMpAccountExists } from './mp-account.service';
import { getWechatTags, WechatApiError } from '../../lib/wechat';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';

export const mapMpTag = entityMapper(mpTagSchema);

const mpTagCrud = defineCrudService(mpTagContract, {
  table: mpTags,
  map: mapMpTag,
  notFound: '标签不存在',
  unique: '该标签名称已存在',
  tenant: true,
  list: (q) => ({
    where: [
      eq(mpTags.accountId, q.accountId),
      keywordCondition(q.keyword, [mpTags.name], 'ilike'),
    ],
    orderBy: [mpTags.id],
  }),
  create: {
    before: async (data) => {
      await ensureMpAccountExists(data.accountId);
    },
    toRow: (data) => ({
      accountId: data.accountId,
      name: data.name,
    }),
  },
  update: {
    toRow: (data) => ({ name: data.name }),
  },
});

export async function listMpTags(q: Parameters<typeof mpTagCrud.list>[0]) {
  await ensureMpAccountExists(q.accountId);
  return mpTagCrud.list(q);
}

export const {
  ensure: ensureMpTagExists,
  create: createMpTag,
  update: updateMpTag,
} = mpTagCrud;

/** 审计前快照 */
export const getMpTagBeforeAudit = mpTagCrud.get;

export async function deleteMpTag(id: number) {
  const tag = await ensureMpTagExists(id);
  await db.transaction(async (tx) => {
    await tx.delete(mpTags).where(eq(mpTags.id, id));
    // 仅清理同一公众号下粉丝的本地标签引用（附加 account_id 过滤防止越权改动并缩小更新范围）
    await tx.execute(sql`
      UPDATE mp_fans
      SET tag_ids = COALESCE((
        SELECT jsonb_agg(elem) FROM jsonb_array_elements(tag_ids) elem WHERE elem <> to_jsonb(${id}::int)
      ), '[]'::jsonb)
      WHERE account_id = ${tag.accountId} AND tag_ids @> to_jsonb(${id}::int)
    `);
  });
}

export const mpTagService = { ...mpTagCrud, list: listMpTags, remove: deleteMpTag };

/** 从微信同步标签到本地（按 wechatTagId / name 去重 upsert） */
export async function syncMpTags(accountId: number): Promise<{ success: boolean; created: number; updated: number; total: number }> {
  const account = await ensureMpAccountExists(accountId);
  let wechatTags;
  try {
    wechatTags = await getWechatTags(account);
  } catch (err) {
    if (err instanceof WechatApiError) throw new HTTPException(400, { message: err.message });
    throw new HTTPException(502, { message: '调用微信接口失败，请检查网络或稍后重试' });
  }
  const tenantId = currentCreateTenantId();
  let created = 0;
  let updated = 0;
  try {
    await db.transaction(async (tx) => {
      for (const wt of wechatTags) {
        const [byTagId] = await tx.select().from(mpTags)
          .where(and(eq(mpTags.accountId, accountId), eq(mpTags.wechatTagId, wt.id))).limit(1);
        if (byTagId) {
          await tx.update(mpTags).set({ name: wt.name, fansCount: wt.count }).where(eq(mpTags.id, byTagId.id));
          updated += 1;
          continue;
        }
        const [byName] = await tx.select().from(mpTags)
          .where(and(eq(mpTags.accountId, accountId), eq(mpTags.name, wt.name))).limit(1);
        if (byName) {
          await tx.update(mpTags).set({ wechatTagId: wt.id, fansCount: wt.count }).where(eq(mpTags.id, byName.id));
          updated += 1;
        } else {
          await tx.insert(mpTags).values({ accountId, wechatTagId: wt.id, name: wt.name, fansCount: wt.count, tenantId });
          created += 1;
        }
      }
    });
  } catch (err) {
    rethrowPgUniqueViolation(err, '同步失败：存在与微信侧重名的本地标签，请先处理重名标签');
  }
  return { success: true, created, updated, total: wechatTags.length };
}
