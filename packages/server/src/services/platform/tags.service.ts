import { asc, eq } from 'drizzle-orm';
import { tagContract, tagSchema } from '@arcbase/shared/platform';
import { db } from '../../db';
import { tags } from '../../db/schema';
import { defineCrudService } from '../../lib/crud-service';
import { entityMapper } from '../../lib/entity-map';
import { keywordCondition } from '../../lib/where-helpers';

export const mapTag = entityMapper(tagSchema);

/** 标签：无租户隔离的平台级字典资源，标准 CRUD 全部由工厂派生 */
export const tagService = defineCrudService(tagContract, {
  table: tags,
  map: mapTag,
  notFound: '标签不存在',
  unique: '标签名称已存在',
  list: (q) => ({
    where: [
      keywordCondition(q.keyword, [tags.name, tags.description]),
      q.status ? eq(tags.status, q.status) : undefined,
      keywordCondition(q.groupName, [tags.groupName]),
    ],
    orderBy: [asc(tags.sortOrder), asc(tags.id)],
  }),
});

export const { list: listTags, get: getTag, ensure: ensureTagExists, create: createTag, update: updateTag, remove: deleteTag, removeMany: batchDeleteTags } = tagService;

// ─── 获取所有分组（用于下拉选项） ──────────────────────────────────────────────

export async function listTagGroups() {
  const rows = await db
    .selectDistinct({ groupName: tags.groupName })
    .from(tags)
    .where(eq(tags.status, 'enabled'))
    .orderBy(asc(tags.groupName));
  return rows.map((r) => r.groupName).filter(Boolean) as string[];
}
