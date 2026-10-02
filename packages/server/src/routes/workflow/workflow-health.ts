import { OpenAPIHono } from '@hono/zod-openapi';
import { workflowHealthContract } from '@arcbase/shared/workflow';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { getWorkflowHealthSummary } from '../../services/workflow/workflow-health.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const summaryRoute = defineContractRoute(workflowHealthContract.summary, {
  handler: async (c) => {
    const { thresholdMinutes } = c.req.valid('query');
    return c.json(okBody(await getWorkflowHealthSummary(thresholdMinutes ?? 30)), 200);
  },
});

router.openapiRoutes([summaryRoute] as const);

export default router;
