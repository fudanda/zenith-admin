import { OpenAPIHono } from '@hono/zod-openapi';
import { reportQueryCapacityContract } from '@arcbase/shared/report';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  createReportQueryQuota,
  deleteReportQueryQuota,
  getReportQueryCostStats,
  getReportQueryCostTrend,
  getReportQueryQuota,
  getReportQueryQuotaUsage,
  listReportQueryCostLogs,
  listReportQueryQuotas,
  resetReportQueryQuotaUsage,
  updateReportQueryQuota,
} from '../../services/report/report-query-capacity.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listQuotasRoute = defineContractRoute(reportQueryCapacityContract.quotas, {
  handler: async (c) => c.json(okBody(await listReportQueryQuotas(c.req.valid('query'))), 200),
});

const getQuotaRoute = defineContractRoute(reportQueryCapacityContract.quotaDetail, {
  handler: async (c) => c.json(okBody(await getReportQueryQuota(c.req.valid('param').id)), 200),
});

const createQuotaRoute = defineContractRoute(reportQueryCapacityContract.createQuota, {
  handler: async (c) => c.json(okBody(await createReportQueryQuota(c.req.valid('json')), '创建成功'), 200),
});

const updateQuotaRoute = defineContractRoute(reportQueryCapacityContract.updateQuota, {
  handler: async (c) => c.json(okBody(await updateReportQueryQuota(c.req.valid('param').id, c.req.valid('json')), '更新成功'), 200),
});

const deleteQuotaRoute = defineContractRoute(reportQueryCapacityContract.removeQuota, {
  handler: async (c) => {
    await deleteReportQueryQuota(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const quotaUsageRoute = defineContractRoute(reportQueryCapacityContract.quotaUsage, {
  handler: async (c) => c.json(okBody(await getReportQueryQuotaUsage(
    c.req.valid('param').id,
    c.req.valid('query').scopeDate,
  )), 200),
});

const resetQuotaRoute = defineContractRoute(reportQueryCapacityContract.resetQuota, {
  handler: async (c) => {
    await resetReportQueryQuotaUsage(c.req.valid('param').id, c.req.valid('json').scopeDate);
    return c.json(okBody(null, '重置成功'), 200);
  },
});

const costLogsRoute = defineContractRoute(reportQueryCapacityContract.costLogs, {
  handler: async (c) => c.json(okBody(await listReportQueryCostLogs(c.req.valid('query'))), 200),
});

const costStatsRoute = defineContractRoute(reportQueryCapacityContract.costStats, {
  handler: async (c) => c.json(okBody(await getReportQueryCostStats(c.req.valid('query'))), 200),
});

const costTrendRoute = defineContractRoute(reportQueryCapacityContract.costTrend, {
  handler: async (c) => c.json(okBody(await getReportQueryCostTrend(c.req.valid('query'))), 200),
});

router.openapiRoutes([
  listQuotasRoute, getQuotaRoute, createQuotaRoute, updateQuotaRoute, deleteQuotaRoute,
  quotaUsageRoute, resetQuotaRoute, costLogsRoute, costStatsRoute, costTrendRoute,
] as const);

export default router;
