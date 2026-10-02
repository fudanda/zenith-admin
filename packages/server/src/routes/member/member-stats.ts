import { OpenAPIHono } from '@hono/zod-openapi';
import { memberStatsContract } from '@arcbase/shared/member';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { getMemberStats, getMemberCharts } from '../../services/member/member-stats.service';

const memberStatsRouter = new OpenAPIHono({ defaultHook: validationHook });

const overviewRoute = defineContractRoute(memberStatsContract.overview, {
  handler: async (c) => c.json(okBody(await getMemberStats()), 200),
});

const chartsRoute = defineContractRoute(memberStatsContract.charts, {
  handler: async (c) => c.json(okBody(await getMemberCharts()), 200),
});

memberStatsRouter.openapiRoutes([overviewRoute, chartsRoute] as const);

export default memberStatsRouter;
