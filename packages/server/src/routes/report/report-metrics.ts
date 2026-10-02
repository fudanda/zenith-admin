import { OpenAPIHono } from '@hono/zod-openapi';
import { reportMetricContract } from '@arcbase/shared/report';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
import {
  collectReportMetricRefs,
  createReportMetric,
  deleteReportMetric,
  deprecateReportMetric,
  evaluateReportMetric,
  getReportMetric,
  listReportMetricLookup,
  listReportMetrics,
  publishReportMetric,
  updateReportMetric,
} from '../../services/report/report-metric.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });
const conflict = { 409: { content: jsonContent(ErrorResponse), description: '版本冲突' } } as const;
const lookupRoute = defineContractRoute(reportMetricContract.lookup, {
  handler: async (c) => c.json(okBody(await listReportMetricLookup(c.req.valid('query'))), 200),
});
const evaluateRoute = defineContractRoute(reportMetricContract.evaluate, {
  handler: async (c) => c.json(okBody(await evaluateReportMetric(c.req.valid('param').id, c.req.valid('json').params)), 200),
});

const publishRoute = defineContractRoute(reportMetricContract.publish, {
  responses: conflict,
  handler: async (c) => c.json(okBody(await publishReportMetric(c.req.valid('param').id, c.req.valid('json')), '发布成功'), 200),
});

const deprecateRoute = defineContractRoute(reportMetricContract.deprecate, {
  responses: conflict,
  handler: async (c) => c.json(okBody(await deprecateReportMetric(c.req.valid('param').id, c.req.valid('json')), '废弃成功'), 200),
});

const refsRoute = defineContractRoute(reportMetricContract.refs, {
  handler: async (c) => c.json(okBody(await collectReportMetricRefs(c.req.valid('param').id)), 200),
});

mountCrud(router, reportMetricContract,
  {
    list: listReportMetrics,
    get: getReportMetric,
    create: createReportMetric,
    update: updateReportMetric,
    remove: deleteReportMetric,
  },
  { responses: { update: conflict } },
  [lookupRoute, evaluateRoute, publishRoute, deprecateRoute, refsRoute],
);

export default router;
