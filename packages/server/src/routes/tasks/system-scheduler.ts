import { OpenAPIHono } from '@hono/zod-openapi';
import { systemSchedulerContract } from '@arcbase/shared/platform';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  acknowledgeSystemSchedulerRunAlert,
  cleanupSystemSchedulerRuns,
  getSystemSchedulerRun,
  listSystemSchedulerNodes,
  listSystemSchedulerRuns,
  listSystemSchedulerTasks,
  runSystemSchedulerTask,
  updateSystemSchedulerTaskConfig,
} from '../../services/tasks/system-scheduler.service';

const systemSchedulerRoutes = new OpenAPIHono({ defaultHook: validationHook });

const tasksRoute = defineContractRoute(systemSchedulerContract.tasks, {
  handler: async (c) => c.json(okBody(await listSystemSchedulerTasks()), 200),
});

const runsRoute = defineContractRoute(systemSchedulerContract.runs, {
  handler: async (c) => c.json(okBody(await listSystemSchedulerRuns(c.req.valid('query'))), 200),
});

const runDetailRoute = defineContractRoute(systemSchedulerContract.runDetail, {
  handler: async (c) => c.json(okBody(await getSystemSchedulerRun(c.req.valid('param').id)), 200),
});

const acknowledgeAlertRoute = defineContractRoute(systemSchedulerContract.acknowledgeAlert, {
  handler: async (c) => c.json(okBody(await acknowledgeSystemSchedulerRunAlert(c.req.valid('param').id, c.req.valid('json').note)), 200),
});

const nodesRoute = defineContractRoute(systemSchedulerContract.nodes, {
  handler: async (c) => c.json(okBody(await listSystemSchedulerNodes(c.req.valid('query'))), 200),
});

const runRoute = defineContractRoute(systemSchedulerContract.runTask, {
  handler: async (c) => c.json(okBody(await runSystemSchedulerTask(c.req.valid('param').name), '执行完成'), 200),
});

const updateConfigRoute = defineContractRoute(systemSchedulerContract.updateTaskConfig, {
  handler: async (c) => c.json(okBody(await updateSystemSchedulerTaskConfig(c.req.valid('param').name, c.req.valid('json'))), 200),
});

const cleanupRunsRoute = defineContractRoute(systemSchedulerContract.cleanupRuns, {
  handler: async (c) => c.json(okBody(await cleanupSystemSchedulerRuns(c.req.valid('query')), '清理完成'), 200),
});

systemSchedulerRoutes.openapiRoutes([tasksRoute, runsRoute, cleanupRunsRoute, runDetailRoute, acknowledgeAlertRoute, nodesRoute, runRoute, updateConfigRoute] as const);

export default systemSchedulerRoutes;
