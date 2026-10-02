import { OpenAPIHono } from '@hono/zod-openapi';
import { sqlMonitorContract } from '@arcbase/shared/platform';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  actOnSqlMonitorSession,
  getSqlMonitorHistory,
  getSqlMonitorOverview,
  listSqlMonitorLocks,
  listSqlMonitorQueries,
  listSqlMonitorSessions,
  resetSqlMonitorStats,
} from '../../services/platform/sql-monitor.service';

const sqlMonitorRouter = new OpenAPIHono({ defaultHook: validationHook });

const overviewRoute = defineContractRoute(sqlMonitorContract.overview, {
  handler: async (c) => c.json(okBody(await getSqlMonitorOverview(), 'success'), 200),
});

const queriesRoute = defineContractRoute(sqlMonitorContract.queries, {
  handler: async (c) => c.json(okBody(await listSqlMonitorQueries(c.req.valid('query')), 'success'), 200),
});

const sessionsRoute = defineContractRoute(sqlMonitorContract.sessions, {
  handler: async (c) => c.json(okBody(await listSqlMonitorSessions(), 'success'), 200),
});

const locksRoute = defineContractRoute(sqlMonitorContract.locks, {
  handler: async (c) => c.json(okBody(await listSqlMonitorLocks(), 'success'), 200),
});

const historyRoute = defineContractRoute(sqlMonitorContract.history, {
  handler: async (c) => c.json(okBody(await getSqlMonitorHistory(c.req.valid('query')), 'success'), 200),
});

const sessionActionRoute = defineContractRoute(sqlMonitorContract.sessionAction, {
  handler: async (c) => c.json(okBody(await actOnSqlMonitorSession(c.req.valid('json')), 'success'), 200),
});

const resetRoute = defineContractRoute(sqlMonitorContract.reset, {
  handler: async (c) => c.json(okBody(await resetSqlMonitorStats(), 'success'), 200),
});

sqlMonitorRouter.openapiRoutes([
  overviewRoute,
  queriesRoute,
  sessionsRoute,
  locksRoute,
  historyRoute,
  sessionActionRoute,
  resetRoute,
] as const);

export default sqlMonitorRouter;
