import { OpenAPIHono } from '@hono/zod-openapi';
import { cmsDashboardContract } from '@arcbase/shared/cms';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { getCmsDashboardStats } from '../../services/cms/cms-dashboard.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const statsRoute = defineContractRoute(cmsDashboardContract.stats, {
  handler: async (c) => c.json(okBody(await getCmsDashboardStats(c.req.valid('query').siteId)), 200),
});

router.openapiRoutes([statsRoute] as const);

export default router;
