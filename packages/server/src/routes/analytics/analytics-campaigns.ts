import { OpenAPIHono } from '@hono/zod-openapi';
import { analyticsCampaignContract } from '@arcbase/shared/analytics';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { listCampaigns, createCampaign, updateCampaign, deleteCampaign, executeCampaign } from '../../services/analytics/analytics-campaigns.service';
import { mapAsyncTask } from '../../lib/task-center';

const r = new OpenAPIHono({ defaultHook: validationHook });

const campaignListRoute = defineContractRoute(analyticsCampaignContract.campaigns, {
  handler: async (c) => c.json(okBody(await listCampaigns(c.req.valid('query'))), 200),
});

const campaignCreateRoute = defineContractRoute(analyticsCampaignContract.createCampaign, {
  handler: async (c) => c.json(okBody(await createCampaign(c.req.valid('json')), '创建成功'), 200),
});

const campaignUpdateRoute = defineContractRoute(analyticsCampaignContract.updateCampaign, {
  handler: async (c) => c.json(okBody(await updateCampaign(c.req.valid('param').id, c.req.valid('json')), '更新成功'), 200),
});

const campaignDeleteRoute = defineContractRoute(analyticsCampaignContract.removeCampaign, {
  handler: async (c) => {
    await deleteCampaign(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const campaignExecuteRoute = defineContractRoute(analyticsCampaignContract.executeCampaign, {
  handler: async (c) => c.json(okBody(mapAsyncTask(await executeCampaign(c.req.valid('param').id)), '任务已提交，可在任务中心查看进度'), 200),
});

r.openapiRoutes([
  campaignListRoute,
  campaignCreateRoute,
  campaignUpdateRoute,
  campaignDeleteRoute,
  campaignExecuteRoute,
] as const);

export default r;
