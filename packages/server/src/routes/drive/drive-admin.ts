import { OpenAPIHono } from '@hono/zod-openapi';
import { driveAdminContract } from '@arcbase/shared/drive';
import { setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { mapAsyncTask } from '../../lib/task-center';
import { listDriveActivitiesForAdmin } from '../../services/drive/drive-activity.service';
import { getDriveAdminStats } from '../../services/drive/drive-admin.service';
import { createLegalHold, decideQuotaRequest, listLegalHolds, listQuotaRequestsForAdmin, releaseLegalHold } from '../../services/drive/drive-governance.service';
import { createOpenAppGrant, getOpenAppGrantBeforeAudit, listOpenAppGrants, removeOpenAppGrant } from '../../services/drive/drive-open.service';
import { adminRevokeDriveShareLink, getShareLinkBeforeAudit, listShareAccessLogsForAdmin, listShareLinksForAdmin } from '../../services/drive/drive-share.service';
import { adminUpdateDriveSpace, createDepartmentSpace, deleteDriveSpace, ensureDriveSpaceExists, listDriveSpacesForAdmin } from '../../services/drive/drive-spaces.service';
import { submitRecalcUsageTask, submitReindexTask } from '../../services/drive/drive-tasks.service';
import { handoffDriveSpace } from '../../services/drive/drive-handoff.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const statsRoute = defineContractRoute(driveAdminContract.stats, {
  handler: async (c) => c.json(okBody(await getDriveAdminStats()), 200),
});

const spacesRoute = defineContractRoute(driveAdminContract.spaces, {
  handler: async (c) => c.json(okBody(await listDriveSpacesForAdmin(c.req.valid('query'))), 200),
});

const createDepartmentSpaceRoute = defineContractRoute(driveAdminContract.createDepartmentSpace, {
  handler: async (c) => c.json(okBody(await createDepartmentSpace(c.req.valid('json')), '创建成功'), 200),
});

const updateSpaceRoute = defineContractRoute(driveAdminContract.updateSpace, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await ensureDriveSpaceExists(id));
    return c.json(okBody(await adminUpdateDriveSpace(id, c.req.valid('json')), '已更新'), 200);
  },
});

const deleteSpaceRoute = defineContractRoute(driveAdminContract.removeSpace, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await ensureDriveSpaceExists(id));
    await deleteDriveSpace(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const recalcRoute = defineContractRoute(driveAdminContract.recalcUsage, {
  handler: async (c) => {
    const task = await submitRecalcUsageTask(c.req.valid('json').spaceId);
    return c.json(okBody(mapAsyncTask(task), '任务已提交'), 200);
  },
});

const reindexRoute = defineContractRoute(driveAdminContract.reindex, {
  handler: async (c) => {
    const task = await submitReindexTask(c.req.valid('json').spaceId);
    return c.json(okBody(mapAsyncTask(task), '任务已提交'), 200);
  },
});

const shareLinksRoute = defineContractRoute(driveAdminContract.shareLinks, {
  handler: async (c) => c.json(okBody(await listShareLinksForAdmin(c.req.valid('query'))), 200),
});

const revokeShareLinkRoute = defineContractRoute(driveAdminContract.revokeShareLink, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getShareLinkBeforeAudit(id));
    await adminRevokeDriveShareLink(id);
    setAuditAfterData(c, await getShareLinkBeforeAudit(id));
    return c.json(okBody(null, '已撤销'), 200);
  },
});

const activitiesRoute = defineContractRoute(driveAdminContract.activities, {
  handler: async (c) => c.json(okBody(await listDriveActivitiesForAdmin(c.req.valid('query'))), 200),
});

const handoffRoute = defineContractRoute(driveAdminContract.handoff, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await ensureDriveSpaceExists(id));
    return c.json(okBody(await handoffDriveSpace(id, c.req.valid('json')), '空间已交接'), 200);
  },
});

// ─── 治理：外链访问日志 / 法律保留 / 扩容审批 / 开放应用授权 ────────────────────

const shareAccessLogsRoute = defineContractRoute(driveAdminContract.shareAccessLogs, {
  handler: async (c) => c.json(okBody(await listShareAccessLogsForAdmin(c.req.valid('query'))), 200),
});

const legalHoldsRoute = defineContractRoute(driveAdminContract.legalHolds, {
  handler: async (c) => c.json(okBody(await listLegalHolds(c.req.valid('query'))), 200),
});

const createLegalHoldRoute = defineContractRoute(driveAdminContract.createLegalHold, {
  handler: async (c) => c.json(okBody(await createLegalHold(c.req.valid('json')), '已设置法律保留'), 200),
});

const releaseLegalHoldRoute = defineContractRoute(driveAdminContract.releaseLegalHold, {
  handler: async (c) => c.json(okBody(await releaseLegalHold(c.req.valid('param').id, c.req.valid('json')), '已解除法律保留'), 200),
});

const quotaRequestsRoute = defineContractRoute(driveAdminContract.quotaRequests, {
  handler: async (c) => c.json(okBody(await listQuotaRequestsForAdmin(c.req.valid('query'))), 200),
});

const decideQuotaRequestRoute = defineContractRoute(driveAdminContract.decideQuotaRequest, {
  handler: async (c) => {
    const body = c.req.valid('json');
    return c.json(okBody(await decideQuotaRequest(c.req.valid('param').id, body), body.approve ? '已通过并写入配额' : '已拒绝'), 200);
  },
});

const openGrantsRoute = defineContractRoute(driveAdminContract.openGrants, {
  handler: async (c) => c.json(okBody(await listOpenAppGrants(c.req.valid('query'))), 200),
});

const createOpenGrantRoute = defineContractRoute(driveAdminContract.createOpenGrant, {
  handler: async (c) => c.json(okBody(await createOpenAppGrant(c.req.valid('json')), '已授权'), 200),
});

const removeOpenGrantRoute = defineContractRoute(driveAdminContract.removeOpenGrant, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getOpenAppGrantBeforeAudit(id));
    await removeOpenAppGrant(id);
    return c.json(okBody(null, '已撤销授权'), 200);
  },
});

// 静态 /spaces/department、/spaces/recalc 先于动态 /spaces/{id}
router.openapiRoutes([
  statsRoute,
  spacesRoute, createDepartmentSpaceRoute, recalcRoute, updateSpaceRoute, deleteSpaceRoute, reindexRoute,
  shareLinksRoute, revokeShareLinkRoute, shareAccessLogsRoute, activitiesRoute, handoffRoute,
  legalHoldsRoute, createLegalHoldRoute, releaseLegalHoldRoute,
  quotaRequestsRoute, decideQuotaRequestRoute,
  openGrantsRoute, createOpenGrantRoute, removeOpenGrantRoute,
] as const);

export default router;
