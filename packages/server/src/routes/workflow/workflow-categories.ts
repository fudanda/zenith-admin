import { OpenAPIHono } from '@hono/zod-openapi';
import { workflowCategoryContract } from '@arcbase/shared/workflow';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listAllWorkflowCategories,
  workflowCategoryService,
} from '../../services/workflow/workflow-categories.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

const allRoute = defineContractRoute(workflowCategoryContract.all, {
  handler: async (c) => c.json(okBody(await listAllWorkflowCategories()), 200),
});

mountCrud(router, workflowCategoryContract,
  workflowCategoryService,
  {},
  [allRoute],
);

export default router;
