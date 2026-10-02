import { OpenAPIHono } from '@hono/zod-openapi';
import { deployReleaseContract, deployRunContract, deployTargetContract } from '@arcbase/shared/ops';
import { defineContractRoute } from '../../lib/contract-route';
import { platformHostOnly } from '../../lib/host-access';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  cancelDeployRun,
  createDeployRun,
  deleteDeployRelease,
  retryDeployRun,
  syncDeployTarget,
} from '../../services/ops/deploy-engine.service';
import { listDeployReleases } from '../../services/ops/deploy-releases.service';
import { getDeployRun, listDeployRunLogs, listDeployRuns } from '../../services/ops/deploy-runs.service';
import {
  createDeployTarget,
  deleteDeployTarget,
  getDeployTarget,
  listDeployTargets,
  updateDeployTarget,
} from '../../services/ops/deploy-targets.service';
import { mountCrud } from '../_crud';

// ─── 部署目标 ─────────────────────────────────────────────────────────────────
export const deployTargetsRouter = new OpenAPIHono({ defaultHook: validationHook });

mountCrud(deployTargetsRouter, deployTargetContract,
  { list: listDeployTargets, get: getDeployTarget, create: createDeployTarget, update: updateDeployTarget, remove: deleteDeployTarget },
  { messages: { create: '已创建', update: '已更新', remove: '已删除' }, middleware: [platformHostOnly] },
);

const targetSyncRoute = defineContractRoute(deployTargetContract.sync, {
  middleware: [platformHostOnly],
  handler: async (c) => c.json(okBody(await syncDeployTarget(c.req.valid('param').id), '已与主机对账'), 200),
});

deployTargetsRouter.openapiRoutes([targetSyncRoute] as const);

// ─── 部署记录 ─────────────────────────────────────────────────────────────────
export const deployRunsRouter = new OpenAPIHono({ defaultHook: validationHook });

const runListRoute = defineContractRoute(deployRunContract.list, {
  middleware: [platformHostOnly],
  handler: async (c) => c.json(okBody(await listDeployRuns(c.req.valid('query'))), 200),
});

const runDetailRoute = defineContractRoute(deployRunContract.detail, {
  middleware: [platformHostOnly],
  handler: async (c) => c.json(okBody(await getDeployRun(c.req.valid('param').id)), 200),
});

const runLogsRoute = defineContractRoute(deployRunContract.logs, {
  middleware: [platformHostOnly],
  handler: async (c) => c.json(okBody(await listDeployRunLogs(c.req.valid('param').id, c.req.valid('query'))), 200),
});

const runCreateRoute = defineContractRoute(deployRunContract.create, {
  middleware: [platformHostOnly],
  handler: async (c) => c.json(okBody(await createDeployRun(c.req.valid('json')), '已提交，任务中心执行中'), 200),
});

const runRetryRoute = defineContractRoute(deployRunContract.retry, {
  middleware: [platformHostOnly],
  handler: async (c) => c.json(okBody(await retryDeployRun(c.req.valid('param').id), '已重新提交'), 200),
});

const runCancelRoute = defineContractRoute(deployRunContract.cancel, {
  middleware: [platformHostOnly],
  handler: async (c) => c.json(okBody(await cancelDeployRun(c.req.valid('param').id), '已请求取消'), 200),
});

deployRunsRouter.openapiRoutes([runListRoute, runCreateRoute, runLogsRoute, runRetryRoute, runCancelRoute, runDetailRoute] as const);

// ─── 发布目录（还原点）───────────────────────────────────────────────────────
export const deployReleasesRouter = new OpenAPIHono({ defaultHook: validationHook });

const releaseListRoute = defineContractRoute(deployReleaseContract.list, {
  middleware: [platformHostOnly],
  handler: async (c) => c.json(okBody(await listDeployReleases(c.req.valid('query'))), 200),
});

const releaseRemoveRoute = defineContractRoute(deployReleaseContract.remove, {
  middleware: [platformHostOnly],
  handler: async (c) => {
    await deleteDeployRelease(c.req.valid('param').id);
    return c.json(okBody(null, '已删除'), 200);
  },
});

deployReleasesRouter.openapiRoutes([releaseListRoute, releaseRemoveRoute] as const);
