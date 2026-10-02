import { OpenAPIHono } from '@hono/zod-openapi';
import { reportDatasourceContract } from '@arcbase/shared/report';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listDatasources,
  getDatasource,
  createDatasource,
  updateDatasource,
  deleteDatasource,
  testDatasource,
  batchSetDatasourceStatus,
  cloneDatasource,
  listDatasourceLookup,
} from '../../services/report/report-datasource.service';
import { submitDatasourceHealthCheckTask } from '../../services/report/report-datasource-tasks';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

const notFound = { 404: { content: jsonContent(ErrorResponse), description: '不存在' } } as const;
const lookupRoute = defineContractRoute(reportDatasourceContract.lookup, {
  handler: async (c) => c.json(okBody(await listDatasourceLookup(c.req.valid('query'))), 200),
});
const batchStatusRoute = defineContractRoute(reportDatasourceContract.batchStatus, {
  handler: async (c) => {
    const { ids, status } = c.req.valid('json');
    const count = await batchSetDatasourceStatus(ids, status);
    return c.json(okBody(null, `已更新 ${count} 个数据源状态`), 200);
  },
});

const testRoute = defineContractRoute(reportDatasourceContract.test, {
  handler: async (c) => c.json(okBody(await testDatasource(c.req.valid('json'))), 200),
});

const testOneRoute = defineContractRoute(reportDatasourceContract.testOne, {
  handler: async (c) => c.json(okBody(await testDatasource({ id: c.req.valid('param').id })), 200),
});

const cloneRoute = defineContractRoute(reportDatasourceContract.clone, {
  handler: async (c) => c.json(okBody(await cloneDatasource(c.req.valid('param').id, c.req.valid('json')), '复制成功'), 200),
});

const healthCheckRoute = defineContractRoute(reportDatasourceContract.healthCheck, {
  handler: async (c) => c.json(okBody(await submitDatasourceHealthCheckTask(c.req.valid('json').ids), '任务已提交，可在任务中心查看进度'), 200),
});

mountCrud(router, reportDatasourceContract,
  {
    list: listDatasources,
    get: getDatasource,
    create: createDatasource,
    update: updateDatasource,
    remove: deleteDatasource,
  },
  {
    responses: { detail: notFound, update: notFound, remove: notFound },
  },
  [lookupRoute, batchStatusRoute, testRoute, testOneRoute, cloneRoute, healthCheckRoute],
);

export default router;