import { OpenAPIHono } from '@hono/zod-openapi';
import { cmsStatContract } from '@arcbase/shared/cms';
import { defineContractRoute } from '../../lib/contract-route';
import { validationHook, okBody } from '../../lib/openapi-schemas';
import { getCmsVisitStats, getCmsSearchAnalytics } from '../../services/cms/cms-stats.service';
import { getCmsStatsOverview, getCmsStatsReport, getCmsStatsQuality, getCmsStatsOptions } from '../../services/cms/cms-stats-query';

const router = new OpenAPIHono({ defaultHook: validationHook });

const visitsRoute = defineContractRoute(cmsStatContract.visits, {
  handler: async (c) => {
    return c.json(okBody(await getCmsVisitStats(c.req.valid('query'))), 200);
  },
});

const searchRoute = defineContractRoute(cmsStatContract.search, {
  handler: async (c) => {
    return c.json(okBody(await getCmsSearchAnalytics(c.req.valid('query'))), 200);
  },
});

const overviewRoute = defineContractRoute(cmsStatContract.overview, { handler: async (c) => c.json(okBody(await getCmsStatsOverview(c.req.valid('query'))), 200) });
const reportRoute = defineContractRoute(cmsStatContract.report, { handler: async (c) => c.json(okBody(await getCmsStatsReport(c.req.valid('query'))), 200) });
const qualityRoute = defineContractRoute(cmsStatContract.quality, { handler: async (c) => c.json(okBody(await getCmsStatsQuality(c.req.valid('query'))), 200) });
const optionsRoute = defineContractRoute(cmsStatContract.options, { handler: async (c) => c.json(okBody(await getCmsStatsOptions(c.req.valid('query'))), 200) });
router.openapiRoutes([visitsRoute, searchRoute, overviewRoute, reportRoute, qualityRoute, optionsRoute] as const);

export default router;
