import { OpenAPIHono } from '@hono/zod-openapi';
import { aiUsageContract } from '@arcbase/shared/ai';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { getUsageStats } from '../../services/ai/ai-usage.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const stats = defineContractRoute(aiUsageContract.stats, {
  handler: async (c) => {
    const { startDate, endDate } = c.req.valid('query');
    return c.json(okBody(await getUsageStats({ startDate, endDate })), 200);
  },
});

router.openapiRoutes([stats] as const);

export default router;
