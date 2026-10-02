import { OpenAPIHono } from '@hono/zod-openapi';
import { analyticsSiteContract } from '@arcbase/shared/analytics';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { createSite, deleteSite, listSites, regenerateSiteKey, updateSite } from '../../services/analytics/analytics-sites.service';

const r = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineContractRoute(analyticsSiteContract.sites, {
  handler: async (c) => c.json(okBody(await listSites(c.req.valid('query'))), 200),
});

const createSiteRoute = defineContractRoute(analyticsSiteContract.createSite, {
  handler: async (c) => c.json(okBody(await createSite(c.req.valid('json')), '创建成功'), 200),
});

const updateSiteRoute = defineContractRoute(analyticsSiteContract.updateSite, {
  handler: async (c) => c.json(okBody(await updateSite(c.req.valid('param').id, c.req.valid('json')), '更新成功'), 200),
});

const deleteSiteRoute = defineContractRoute(analyticsSiteContract.removeSite, {
  handler: async (c) => {
    await deleteSite(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const regenerateKeyRoute = defineContractRoute(analyticsSiteContract.regenerateSiteKey, {
  handler: async (c) => c.json(okBody(await regenerateSiteKey(c.req.valid('param').id), '重新生成成功'), 200),
});

r.openapiRoutes([listRoute, createSiteRoute, updateSiteRoute, deleteSiteRoute, regenerateKeyRoute] as const);

export default r;
