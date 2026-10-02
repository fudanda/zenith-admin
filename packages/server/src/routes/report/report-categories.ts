import { OpenAPIHono } from '@hono/zod-openapi';
import { reportCategoryContract } from '@arcbase/shared/report';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
import { listCategories, createCategory, updateCategory, deleteCategory, ensureCategoryExists, listCategoryLookup, mapCategory } from '../../services/report/report-ops.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

const notFound = { 404: { content: jsonContent(ErrorResponse), description: '不存在' } } as const;

const lookupRoute = defineContractRoute(reportCategoryContract.lookup, {
  handler: async (c) => c.json(okBody(await listCategoryLookup(c.req.valid('query'))), 200),
});

mountCrud(router, reportCategoryContract,
  {
    get: async (id: number) => mapCategory(await ensureCategoryExists(id)),
    create: createCategory,
    update: updateCategory,
    remove: deleteCategory,
    list: listCategories,
  },
  {
    responses: { update: notFound, remove: notFound },
  },
  [lookupRoute],
);

export default router;
