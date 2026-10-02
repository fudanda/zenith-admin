import { desc, eq } from 'drizzle-orm';
import { mpDraftContract, mpDraftSchema, type MpArticle } from '@arcbase/shared/mp';
import { db } from '../../db';
import { mpDrafts, type MpDraftRow } from '../../db/schema';
import { defineCrudService } from '../../lib/crud-service';
import { entityMapper } from '../../lib/entity-map';
import { keywordCondition } from '../../lib/where-helpers';
import { ensureMpAccountExists } from './mp-account.service';
import { addWechatDraft } from '../../lib/wechat';
import { mapWechatError } from '../../lib/wechat-error';
import { requireRow } from '../../lib/db-assert';

export const mapMpDraft = entityMapper(mpDraftSchema, (row: MpDraftRow) => ({
  articles: (row.articles ?? []) as MpArticle[],
}));

const mpDraftCrud = defineCrudService(mpDraftContract, {
  table: mpDrafts,
  map: mapMpDraft,
  notFound: '图文草稿不存在',
  tenant: true,
  list: (q) => ({
    where: [
      eq(mpDrafts.accountId, q.accountId),
      keywordCondition(q.keyword, [mpDrafts.title], 'ilike'),
    ],
    orderBy: [desc(mpDrafts.id)],
  }),
  create: {
    before: async (data) => {
      await ensureMpAccountExists(data.accountId);
    },
    toRow: (data) => ({
      accountId: data.accountId,
      title: data.articles[0]?.title ?? '未命名图文',
      articles: data.articles,
    }),
  },
  update: {
    toRow: (data) => ({
      title: data.articles[0]?.title ?? '未命名图文',
      articles: data.articles,
      status: 'draft' as const,
      wechatMediaId: null,
    }),
  },
});

export async function listMpDrafts(q: Parameters<typeof mpDraftCrud.list>[0]) {
  await ensureMpAccountExists(q.accountId);
  return mpDraftCrud.list(q);
}

export const mpDraftService = { ...mpDraftCrud, list: listMpDrafts };

export const {
  get: getMpDraft,
  ensure: ensureMpDraftExists,
  create: createMpDraft,
  update: updateMpDraft,
  remove: deleteMpDraft,
} = mpDraftCrud;

/** 推送图文草稿到微信草稿箱 */
export async function pushMpDraft(id: number) {
  const row = await ensureMpDraftExists(id);
  const account = await ensureMpAccountExists(row.accountId);
  const articles = (row.articles ?? []) as MpArticle[];
  requireRow(articles[0], '草稿内容为空', 400);
  let mediaId: string;
  try {
    mediaId = await addWechatDraft(account, articles);
  } catch (err) {
    return mapWechatError(err);
  }
  const [updated] = await db.update(mpDrafts).set({ wechatMediaId: mediaId, status: 'published' }).where(eq(mpDrafts.id, id)).returning();
  return mapMpDraft(updated);
}
