import { OpenAPIHono } from '@hono/zod-openapi';
import { opsOverviewContract } from '@arcbase/shared/ops';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { getOpsOverview } from '../../services/ops/ops-overview.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const overviewRoute = defineContractRoute(opsOverviewContract.get, {
  handler: async (c) => {
    const user = c.get('user');
    return c.json(okBody(await getOpsOverview(user.tenantId == null)), 200);
  },
});

router.openapiRoutes([overviewRoute] as const);

export default router;
