import { asc, eq } from 'drizzle-orm';
import { wikiTemplateContract, wikiTemplateSchema } from '@arcbase/shared/wiki';
import { db } from '../../db';
import { wikiTemplates } from '../../db/schema';
import { defineCrudService } from '../../lib/crud-service';
import { entityMapper } from '../../lib/entity-map';
import { keywordCondition } from '../../lib/where-helpers';

export const mapWikiTemplate = entityMapper(wikiTemplateSchema);

export const wikiTemplateService = defineCrudService(wikiTemplateContract, {
  table: wikiTemplates,
  map: mapWikiTemplate,
  notFound: '模板不存在',
  list: (q) => ({
    where: [
      keywordCondition(q.keyword, [wikiTemplates.name, wikiTemplates.description]),
      q.status ? eq(wikiTemplates.status, q.status) : undefined,
    ],
    orderBy: [asc(wikiTemplates.sort), asc(wikiTemplates.id)],
  }),
});

export const {
  list: listWikiTemplates,
  get: getWikiTemplate,
  ensure: ensureWikiTemplateExists,
  create: createWikiTemplate,
  update: updateWikiTemplate,
  remove: deleteWikiTemplate,
} = wikiTemplateService;

/** 全部启用模板（编辑器选用下拉） */
export async function listAllWikiTemplates() {
  const rows = await db.select().from(wikiTemplates)
    .where(eq(wikiTemplates.status, 'enabled'))
    .orderBy(asc(wikiTemplates.sort), asc(wikiTemplates.id));
  return rows.map(mapWikiTemplate);
}
