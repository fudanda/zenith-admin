import { OpenAPIHono, z } from '@hono/zod-openapi';
import { reportDashboardContract, reportDashboardRevisionConflictSchema, type ReportWidget } from '@arcbase/shared/report';
import { setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, jsonContent, okBody, validationHook, errBody } from '../../lib/openapi-schemas';
import {
  DashboardRevisionConflictError,
  batchSetDashboardStatus,
  cloneDashboard,
  createDashboard,
  deleteDashboard,
  ensureDashboardExists,
  getDashboard,
  getDashboardData,
  listDashboardLookup,
  listDashboards,
  resolveDashboardSnapshotForMode,
  updateDashboardDraft,
} from '../../services/report/report-dashboard.service';
import { offlineDashboard, publishDashboard } from '../../services/report/report-ops.service';
import { recordReportAssetUsage } from '../../services/report/report-asset-usage.service';
import { resolveReportResource } from '../../services/report/report-resource.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

/** 乐观锁冲突：HTTP 409，data 携带当前修订号与最新仪表盘 */
export const dashboardConflictResponse = {
  409: {
    content: jsonContent(z.object({
      code: z.literal(409),
      message: z.string(),
      data: reportDashboardRevisionConflictSchema,
    })),
    description: '版本冲突',
  },
} as const;

const notFound = { 404: { content: jsonContent(ErrorResponse), description: '不存在' } } as const;
const lookupRoute = defineContractRoute(reportDashboardContract.lookup, {
  handler: async (c) => c.json(okBody(await listDashboardLookup(c.req.valid('query'))), 200),
});

const batchRoute = defineContractRoute(reportDashboardContract.batch, {
  handler: async (c) => {
    const body = c.req.valid('json');
    const list = await Promise.all(body.ids.map((id) => getDashboard(id, {
      mode: body.mode ?? 'auto',
      allowOfflinePublished: true,
    })));
    return c.json(okBody(list), 200);
  },
});

const batchStatusRoute = defineContractRoute(reportDashboardContract.batchStatus, {
  handler: async (c) => {
    const { ids, status } = c.req.valid('json');
    const count = await batchSetDashboardStatus(ids, status);
    return c.json(okBody(null, `已更新 ${count} 个仪表盘状态`), 200);
  },
});

const dataRoute = defineContractRoute(reportDashboardContract.data, {
  responses: notFound,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const mode = c.req.valid('query').mode ?? 'auto';
    const dash = await ensureDashboardExists(id);
    const snapshot = await resolveDashboardSnapshotForMode(dash, mode, { allowOfflinePublished: true });
    const data = await getDashboardData(
      (snapshot.widgets ?? []) as ReportWidget[],
      (body.filters ?? {}) as Record<string, unknown>,
      body.limit,
      body.widgetQueries,
      id,
    );
    return c.json(okBody(data), 200);
  },
});

const getOneRoute = defineContractRoute(reportDashboardContract.detail, {
  responses: notFound,
  handler: async (c) => {
    const dashboard = await getDashboard(c.req.valid('param').id, {
      mode: c.req.valid('query').mode ?? 'auto',
      allowOfflinePublished: true,
    });
    const resource = await resolveReportResource('dashboard', dashboard.id);
    await recordReportAssetUsage({
      tenantId: resource.tenantId,
      resourceType: 'dashboard',
      resourceId: dashboard.id,
      action: 'view',
      scene: 'dashboard_detail',
    });
    return c.json(okBody(dashboard), 200);
  },
});

/** 乐观并发冲突（revision 不匹配）的 409 响应体：附当前版本与最新仪表盘供前端合并 */
function dashboardConflictBody(err: DashboardRevisionConflictError) {
  return { ...errBody(err.message, 409), data: { currentRevision: err.currentRevision, dashboard: err.currentDashboard } };
}
const updateRoute_ = defineContractRoute(reportDashboardContract.update, {
  responses: { ...notFound, ...dashboardConflictResponse },
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await ensureDashboardExists(id);
    setAuditBeforeData(c, before);
    try {
      return c.json(okBody(await updateDashboardDraft(id, c.req.valid('json')), '更新成功'), 200);
    } catch (err) {
      if (err instanceof DashboardRevisionConflictError) return c.json(dashboardConflictBody(err), 409);
      throw err;
    }
  },
});

const publishRoute = defineContractRoute(reportDashboardContract.publish, {
  responses: dashboardConflictResponse,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await ensureDashboardExists(id);
    setAuditBeforeData(c, before);
    try {
      return c.json(okBody(await publishDashboard(id, c.req.valid('json')), '发布成功'), 200);
    } catch (err) {
      if (err instanceof DashboardRevisionConflictError) return c.json(dashboardConflictBody(err), 409);
      throw err;
    }
  },
});

const offlineRoute = defineContractRoute(reportDashboardContract.offline, {
  responses: dashboardConflictResponse,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await ensureDashboardExists(id);
    setAuditBeforeData(c, before);
    try {
      return c.json(okBody(await offlineDashboard(id, c.req.valid('json')), '下线成功'), 200);
    } catch (err) {
      if (err instanceof DashboardRevisionConflictError) return c.json(dashboardConflictBody(err), 409);
      throw err;
    }
  },
});
const cloneRoute = defineContractRoute(reportDashboardContract.clone, {
  handler: async (c) => c.json(okBody(await cloneDashboard(c.req.valid('param').id, c.req.valid('json')), '复制成功'), 200),
});

mountCrud(router, reportDashboardContract,
  { list: listDashboards, get: getDashboard, create: createDashboard, remove: deleteDashboard },
  {
    exclude: ['detail', 'update'],
    responses: { remove: notFound },
  },
  [
    lookupRoute,
    batchRoute,
    batchStatusRoute,
    dataRoute,
    getOneRoute,
    updateRoute_,
    publishRoute,
    offlineRoute,
    cloneRoute,
  ],
);

export default router;
