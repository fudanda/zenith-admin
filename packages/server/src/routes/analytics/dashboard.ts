import { OpenAPIHono } from '@hono/zod-openapi';
import { dashboardContract } from '@arcbase/shared/analytics';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { getDashboardStats, getDashboardCharts } from '../../services/analytics/dashboard.service';

const dashboardRoute = new OpenAPIHono({ defaultHook: validationHook });

const statsRouteDef = defineContractRoute(dashboardContract.stats, {
  handler: async (c) => c.json(okBody(await getDashboardStats()), 200),
});

const chartsRouteDef = defineContractRoute(dashboardContract.charts, {
  handler: async (c) => c.json(okBody(await getDashboardCharts()), 200),
});

dashboardRoute.openapiRoutes([statsRouteDef, chartsRouteDef] as const);

export default dashboardRoute;
