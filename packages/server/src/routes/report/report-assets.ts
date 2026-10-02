import { OpenAPIHono } from '@hono/zod-openapi';
import { reportAssetContract, reportResourceTypeSchema } from '@arcbase/shared/report';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  applyReportAssetTemplate,
  cloneReportAssetTemplate,
  createReportAssetTemplate,
  createReportDeprecationNotice,
  deleteReportAssetTemplate,
  deleteReportDeprecationNotice,
  getReportAssetTemplate,
  getReportAssetUsageSummary,
  getReportAssetUsageTrend,
  listInactiveReportAssets,
  listReportAssetCatalog,
  listReportAssetTemplates,
  listReportDeprecationNotices,
  listTopReportAssets,
  publishReportDeprecationNotice,
  updateReportAssetTemplate,
  updateReportDeprecationNotice,
} from '../../services/report/report-asset.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const catalogRoute = defineContractRoute(reportAssetContract.catalog, {
  handler: async (c) => {
    const query = c.req.valid('query');
    const parsedTypes = query.types?.split(',').map((item) => reportResourceTypeSchema.safeParse(item.trim()))
      .filter((item) => item.success).map((item) => item.data);
    return c.json(okBody(await listReportAssetCatalog({ ...query, types: parsedTypes })), 200);
  },
});

const usageSummaryRoute = defineContractRoute(reportAssetContract.usage, {
  handler: async (c) => {
    const params = c.req.valid('param');
    return c.json(okBody(await getReportAssetUsageSummary(params.resourceType, params.id, c.req.valid('query').days)), 200);
  },
});

const topAssetsRoute = defineContractRoute(reportAssetContract.topAssets, {
  handler: async (c) => c.json(okBody(await listTopReportAssets(c.req.valid('query'))), 200),
});

const inactiveAssetsRoute = defineContractRoute(reportAssetContract.inactiveAssets, {
  handler: async (c) => c.json(okBody(await listInactiveReportAssets(c.req.valid('query'))), 200),
});

const usageTrendRoute = defineContractRoute(reportAssetContract.usageTrend, {
  handler: async (c) => c.json(okBody(await getReportAssetUsageTrend(c.req.valid('query'))), 200),
});

const listNoticesRoute = defineContractRoute(reportAssetContract.deprecations, {
  handler: async (c) => c.json(okBody(await listReportDeprecationNotices(c.req.valid('query'))), 200),
});

const createNoticeRoute = defineContractRoute(reportAssetContract.createDeprecation, {
  handler: async (c) => c.json(okBody(await createReportDeprecationNotice(c.req.valid('json')), '创建成功'), 200),
});

const updateNoticeRoute = defineContractRoute(reportAssetContract.updateDeprecation, {
  handler: async (c) => c.json(okBody(await updateReportDeprecationNotice(c.req.valid('param').id, c.req.valid('json')), '更新成功'), 200),
});

const publishNoticeRoute = defineContractRoute(reportAssetContract.publishDeprecation, {
  handler: async (c) => c.json(okBody(await publishReportDeprecationNotice(
    c.req.valid('param').id,
    c.req.valid('json').publish,
  ), '操作成功'), 200),
});

const deleteNoticeRoute = defineContractRoute(reportAssetContract.removeDeprecation, {
  handler: async (c) => {
    await deleteReportDeprecationNotice(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const listTemplatesRoute = defineContractRoute(reportAssetContract.templates, {
  handler: async (c) => c.json(okBody(await listReportAssetTemplates(c.req.valid('query'))), 200),
});

const getTemplateRoute = defineContractRoute(reportAssetContract.templateDetail, {
  handler: async (c) => c.json(okBody(await getReportAssetTemplate(c.req.valid('param').id)), 200),
});

const createTemplateRoute = defineContractRoute(reportAssetContract.createTemplate, {
  handler: async (c) => c.json(okBody(await createReportAssetTemplate(c.req.valid('json')), '创建成功'), 200),
});

const updateTemplateRoute = defineContractRoute(reportAssetContract.updateTemplate, {
  handler: async (c) => c.json(okBody(await updateReportAssetTemplate(c.req.valid('param').id, c.req.valid('json')), '更新成功'), 200),
});

const cloneTemplateRoute = defineContractRoute(reportAssetContract.cloneTemplate, {
  handler: async (c) => c.json(okBody(await cloneReportAssetTemplate(c.req.valid('param').id, c.req.valid('json')), '克隆成功'), 200),
});

const applyTemplateRoute = defineContractRoute(reportAssetContract.applyTemplate, {
  handler: async (c) => c.json(okBody(await applyReportAssetTemplate(c.req.valid('param').id, c.req.valid('json')), '应用成功'), 200),
});

const deleteTemplateRoute = defineContractRoute(reportAssetContract.removeTemplate, {
  handler: async (c) => {
    await deleteReportAssetTemplate(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([
  catalogRoute, usageSummaryRoute, topAssetsRoute, inactiveAssetsRoute, usageTrendRoute,
  listNoticesRoute, createNoticeRoute, updateNoticeRoute, publishNoticeRoute, deleteNoticeRoute,
  listTemplatesRoute, getTemplateRoute, createTemplateRoute, updateTemplateRoute,
  cloneTemplateRoute, applyTemplateRoute, deleteTemplateRoute,
] as const);

export default router;
