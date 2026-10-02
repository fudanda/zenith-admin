import { workflowCategoryContract, workflowCategorySchema } from '@arcbase/shared/workflow';
import { asc, desc, eq } from 'drizzle-orm';
import { db } from '../../db';
import { workflowCategories, workflowDefinitions } from '../../db/schema';
import { HTTPException } from 'hono/http-exception';
import { defineCrudService } from '../../lib/crud-service';
import { entityMapper } from '../../lib/entity-map';
import { keywordCondition } from '../../lib/where-helpers';

export const mapCategory = entityMapper(workflowCategorySchema);

export const workflowCategoryService = defineCrudService(workflowCategoryContract, {
  table: workflowCategories,
  map: mapCategory,
  notFound: '流程分类不存在',
  unique: '分类编码已存在',
  tenant: true,
  list: (q) => ({
    where: [keywordCondition(q.keyword, [workflowCategories.name])],
    orderBy: [asc(workflowCategories.sort), desc(workflowCategories.id)],
  }),
  create: {
    toRow: (input) => ({
      name: input.name,
      code: input.code ?? null,
      icon: input.icon ?? null,
      color: input.color ?? null,
      sort: input.sort ?? 0,
      description: input.description ?? null,
    }),
  },
  update: {
    toRow: (input) => ({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.code !== undefined ? { code: input.code } : {}),
      ...(input.icon !== undefined ? { icon: input.icon } : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
      ...(input.sort !== undefined ? { sort: input.sort } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
    }),
  },
  remove: {
    before: async (row) => {
      const used = await db.$count(workflowDefinitions, eq(workflowDefinitions.categoryId, row.id));
      if (used > 0) throw new HTTPException(400, { message: '该分类下仍有流程定义，无法删除' });
    },
  },
});

export const {
  list: listWorkflowCategories,
  ensure: ensureCategoryExists,
  get: getWorkflowCategory,
  create: createWorkflowCategory,
  update: updateWorkflowCategory,
  remove: deleteWorkflowCategory,
} = workflowCategoryService;

export async function listAllWorkflowCategories() {
  const rows = await db.select().from(workflowCategories).where(workflowCategoryService.scope()).orderBy(asc(workflowCategories.sort), desc(workflowCategories.id));
  return rows.map(mapCategory);
}

export async function getWorkflowCategoryBeforeAudit(id: number) {
  return getWorkflowCategory(id).catch((err) => {
    if (err instanceof HTTPException && err.status === 404) return null;
    throw err;
  });
}
