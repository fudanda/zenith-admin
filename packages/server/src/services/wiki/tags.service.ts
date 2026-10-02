import { asc, eq, sql } from 'drizzle-orm';
import type { QueryOutputOf } from '@arcbase/shared/core';
import { wikiTagContract, wikiTagSchema } from '@arcbase/shared/wiki';
import { db } from '../../db';
import { wikiDocTags, wikiTags, type WikiTagRow } from '../../db/schema';
import { defineCrudService } from '../../lib/crud-service';
import { entityMapper } from '../../lib/entity-map';
import { buildListResult } from '../../lib/list-query';
import { buildWhere, keywordCondition, withPagination } from '../../lib/where-helpers';

export const mapWikiTag = entityMapper(wikiTagSchema, (_row: WikiTagRow) => ({ docCount: undefined }));

type WikiTagListFilter = Omit<QueryOutputOf<typeof wikiTagContract.list>, 'page' | 'pageSize'>;

interface WikiTagWhereInput extends WikiTagListFilter {
  id?: number;
}

function buildWikiTagWhere(q: WikiTagWhereInput) {
  return buildWhere(
    q.id !== undefined ? eq(wikiTags.id, q.id) : undefined,
    keywordCondition(q.keyword, [wikiTags.name]),
  );
}

export const wikiTagService = defineCrudService(wikiTagContract, {
  table: wikiTags,
  map: mapWikiTag,
  notFound: '标签不存在',
  unique: '标签名称已存在',
  list: (q) => ({
    where: [keywordCondition(q.keyword, [wikiTags.name])],
    orderBy: [asc(wikiTags.id)],
  }),
});

export async function listWikiTags(q: QueryOutputOf<typeof wikiTagContract.list>) {
  const { page, pageSize } = q;
  const where = buildWikiTagWhere(q);

  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(wikiTags, where),
    rows: () => withPagination(
      db.select({
        tag: wikiTags,
        docCount: sql<number>`count(${wikiDocTags.docId})::int`,
      }).from(wikiTags)
        .leftJoin(wikiDocTags, eq(wikiTags.id, wikiDocTags.tagId))
        .where(where)
        .groupBy(wikiTags.id)
        .orderBy(asc(wikiTags.id)).$dynamic(),
      page,
      pageSize,
    ),
    map: (r) => ({ ...mapWikiTag(r.tag), docCount: r.docCount }),
  });
}

/** 全部标签（编辑器打标下拉） */
export async function listAllWikiTags() {
  const rows = await db.select().from(wikiTags).orderBy(asc(wikiTags.id));
  return rows.map(mapWikiTag);
}

export const { get: getWikiTag, ensure: ensureWikiTagExists, create: createWikiTag, update: updateWikiTag, remove: deleteWikiTag } = wikiTagService;
