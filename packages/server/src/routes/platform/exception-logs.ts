import { OpenAPIHono } from '@hono/zod-openapi';
import { exceptionLogContract } from '@arcbase/shared/platform';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  batchUpdateExceptionGroupStatus,
  createExceptionAlertRule,
  deleteExceptionAlertRule,
  deleteExceptionGroups,
  getExceptionEvent,
  getExceptionGroupDetail,
  getExceptionOverview,
  getReporterStatus,
  listExceptionAlertLogs,
  listExceptionAlertRules,
  listExceptionEvents,
  listExceptionGroups,
  testExceptionAlertRule,
  updateExceptionAlertRule,
  updateExceptionGroup,
} from '../../services/platform/exception-logs.service';

const r = new OpenAPIHono({ defaultHook: validationHook });

const overviewRoute = defineContractRoute(exceptionLogContract.overview, {
  handler: async (c) => c.json(okBody(await getExceptionOverview(c.req.valid('query').days)), 200),
});

const reporterStatusRoute = defineContractRoute(exceptionLogContract.reporterStatus, {
  handler: (c) => c.json(okBody(getReporterStatus()), 200),
});

const groupListRoute = defineContractRoute(exceptionLogContract.groups, {
  handler: async (c) => c.json(okBody(await listExceptionGroups(c.req.valid('query'))), 200),
});

const batchStatusRoute = defineContractRoute(exceptionLogContract.batchUpdateGroupStatus, {
  handler: async (c) => {
    const n = await batchUpdateExceptionGroupStatus(c.req.valid('json').ids, c.req.valid('query').status);
    return c.json(okBody(null, `已更新 ${n} 条`), 200);
  },
});

const batchDeleteRoute = defineContractRoute(exceptionLogContract.batchDeleteGroups, {
  handler: async (c) => {
    const n = await deleteExceptionGroups(c.req.valid('json').ids);
    return c.json(okBody(null, `已删除 ${n} 条`), 200);
  },
});

const groupDetailRoute = defineContractRoute(exceptionLogContract.groupDetail, {
  handler: async (c) => c.json(okBody(await getExceptionGroupDetail(c.req.valid('param').id)), 200),
});

const groupUpdateRoute = defineContractRoute(exceptionLogContract.updateGroup, {
  handler: async (c) => c.json(okBody(await updateExceptionGroup(c.req.valid('param').id, c.req.valid('json')), '更新成功'), 200),
});

const eventListRoute = defineContractRoute(exceptionLogContract.events, {
  handler: async (c) => c.json(okBody(await listExceptionEvents(c.req.valid('query'))), 200),
});

const eventDetailRoute = defineContractRoute(exceptionLogContract.eventDetail, {
  handler: async (c) => c.json(okBody(await getExceptionEvent(c.req.valid('param').id)), 200),
});

const alertListRoute = defineContractRoute(exceptionLogContract.alerts, {
  handler: async (c) => c.json(okBody(await listExceptionAlertRules(c.req.valid('query'))), 200),
});

const alertCreateRoute = defineContractRoute(exceptionLogContract.createAlert, {
  handler: async (c) => c.json(okBody(await createExceptionAlertRule(c.req.valid('json')), '创建成功'), 200),
});

const alertUpdateRoute = defineContractRoute(exceptionLogContract.updateAlert, {
  handler: async (c) => c.json(okBody(await updateExceptionAlertRule(c.req.valid('param').id, c.req.valid('json')), '更新成功'), 200),
});

const alertDeleteRoute = defineContractRoute(exceptionLogContract.removeAlert, {
  handler: async (c) => {
    await deleteExceptionAlertRule(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const alertTestRoute = defineContractRoute(exceptionLogContract.testAlert, {
  handler: async (c) => {
    await testExceptionAlertRule(c.req.valid('param').id);
    return c.json(okBody(null, '测试消息已发送，请检查各通知渠道'), 200);
  },
});

const alertLogListRoute = defineContractRoute(exceptionLogContract.alertLogs, {
  handler: async (c) => c.json(okBody(await listExceptionAlertLogs(c.req.valid('query'))), 200),
});

r.openapiRoutes([
  overviewRoute, reporterStatusRoute,
  groupListRoute, batchStatusRoute, batchDeleteRoute, groupDetailRoute, groupUpdateRoute,
  eventListRoute, eventDetailRoute,
  alertListRoute, alertCreateRoute, alertUpdateRoute, alertDeleteRoute, alertTestRoute, alertLogListRoute,
]);

export default r;
