import { OpenAPIHono } from '@hono/zod-openapi';
import { workflowAutomationContract } from '@arcbase/shared/workflow';
import { setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listWorkflowAutomations,
  listWorkflowAutomationRuns,
  getWorkflowAutomation,
  createWorkflowAutomation,
  updateWorkflowAutomation,
  deleteWorkflowAutomation,
  batchDeleteWorkflowAutomations,
  getWorkflowAutomationsBeforeAudit,
} from '../../services/workflow/workflow-automations.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRunsRoute = defineContractRoute(workflowAutomationContract.runs, {
  handler: async (c) => c.json(okBody(await listWorkflowAutomationRuns(c.req.valid('query'))), 200),
});
const batchDeleteRoute = defineContractRoute(workflowAutomationContract.batchDelete, {
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const before = await getWorkflowAutomationsBeforeAudit(ids);
    if (before.length > 0) setAuditBeforeData(c, before);
    const n = await batchDeleteWorkflowAutomations(ids);
    return c.json(okBody(null, `成功删除 ${n} 条`), 200);
  },
});

mountCrud(router, workflowAutomationContract,
  {
    list: listWorkflowAutomations,
    get: getWorkflowAutomation,
    create: createWorkflowAutomation,
    update: updateWorkflowAutomation,
    remove: deleteWorkflowAutomation,
  },
  {},
  [listRunsRoute, batchDeleteRoute],
);

export default router;
