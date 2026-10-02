import { OpenAPIHono } from '@hono/zod-openapi';
import { workflowConnectorContract } from '@arcbase/shared/workflow';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  workflowConnectorService,
  testWorkflowConnector,
  getConnectorStats,
  listConnectorInvocations,
} from '../../services/workflow/workflow-connectors.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

const testRoute = defineContractRoute(workflowConnectorContract.test, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await testWorkflowConnector(id, c.req.valid('json'))), 200);
  },
});

const statsRoute = defineContractRoute(workflowConnectorContract.stats, {
  handler: async (c) => c.json(okBody(await getConnectorStats(c.req.valid('param').id, c.req.valid('query').days)), 200),
});

const invocationsRoute = defineContractRoute(workflowConnectorContract.invocations, {
  handler: async (c) => c.json(okBody(await listConnectorInvocations(c.req.valid('param').id, c.req.valid('query').limit)), 200),
});

mountCrud(router, workflowConnectorContract,
  workflowConnectorService,
  {},
  [testRoute, statsRoute, invocationsRoute],
);

export default router;
