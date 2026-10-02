import { OpenAPIHono } from '@hono/zod-openapi';
import { cronJobContract } from '@arcbase/shared/platform';
import { setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { validateCronExpression, getRegisteredHandlers } from '../../lib/pg-boss-scheduler';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  runCronJob,
  setCronJobStatus,
  listAllCronJobLogs,
  listCronJobLogs,
  clearCronJobLogs,
  getCronJobBeforeAudit,
  getClearCronJobLogsBeforeAudit,
  cronJobService,
  getCronJobStats,
  getCronJobDetailStats,
} from '../../services/tasks/cron-jobs.service';
import { mountCrud } from '../_crud';

const cronJobsRoute = new OpenAPIHono({ defaultHook: validationHook });

const handlersRoute = defineContractRoute(cronJobContract.handlers, {
  handler: async (c) => c.json(okBody(getRegisteredHandlers()), 200),
});

const validateRoute = defineContractRoute(cronJobContract.validate, {
  handler: async (c) => {
    const { expression } = c.req.valid('json');
    return c.json(okBody({ valid: validateCronExpression(expression) }), 200);
  },
});
const runRoute = defineContractRoute(cronJobContract.run, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const msg = await runCronJob(id);
    return c.json(okBody(null, msg), 200);
  },
});

const statusRoute = defineContractRoute(cronJobContract.setStatus, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { status } = c.req.valid('json');
    const before = await getCronJobBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    const msg = await setCronJobStatus(id, status);
    const after = await getCronJobBeforeAudit(id);
    if (after) setAuditAfterData(c, after);
    return c.json(okBody(null, msg), 200);
  },
});

const logsRoute = defineContractRoute(cronJobContract.logs, {
  handler: async (c) => c.json(okBody(await listAllCronJobLogs(c.req.valid('query'))), 200),
});

const idLogsRoute = defineContractRoute(cronJobContract.jobLogs, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await listCronJobLogs(id, c.req.valid('query'))), 200);
  },
});

const jobStatsRoute = defineContractRoute(cronJobContract.jobStats, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await getCronJobDetailStats(id, c.req.valid('query'))), 200);
  },
});

const clearAllLogsRoute = defineContractRoute(cronJobContract.clearLogs, {
  handler: async (c) => {
    const { days } = c.req.valid('query');
    const before = await getClearCronJobLogsBeforeAudit(days);
    setAuditBeforeData(c, before);
    const count = await clearCronJobLogs(days);
    setAuditAfterData(c, { days, deleted: count });
    return c.json(okBody(null, `已清除 ${count} 条日志`), 200);
  },
});

const clearJobLogsRoute = defineContractRoute(cronJobContract.clearJobLogs, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { days } = c.req.valid('query');
    const before = await getClearCronJobLogsBeforeAudit(days, id);
    setAuditBeforeData(c, before);
    const count = await clearCronJobLogs(days, id);
    setAuditAfterData(c, { jobId: id, days, deleted: count });
    return c.json(okBody(null, `已清除 ${count} 条日志`), 200);
  },
});

const statsRoute = defineContractRoute(cronJobContract.stats, {
  handler: async (c) => c.json(okBody(await getCronJobStats(c.req.valid('query'))), 200),
});

mountCrud(cronJobsRoute, cronJobContract,
  cronJobService,
  {},
  [
    handlersRoute,
    validateRoute,
    logsRoute,
    clearAllLogsRoute,
    statsRoute,
    runRoute,
    statusRoute,
    idLogsRoute,
    jobStatsRoute,
    clearJobLogsRoute,
  ],
);

export default cronJobsRoute;
