import { OpenAPIHono } from '@hono/zod-openapi';
import { reportAlertContract } from '@arcbase/shared/report';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listAlerts,
  getAlert,
  createAlert,
  updateAlert,
  deleteAlert,
  batchSetAlertEnabled,
} from '../../services/report/report-alert.service';
import { submitAlertEvaluateTask } from '../../services/report/report-delivery-tasks';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

const notFound = { 404: { content: jsonContent(ErrorResponse), description: '不存在' } } as const;
const batchStatusRoute = defineContractRoute(reportAlertContract.batchStatus, {
  handler: async (c) => {
    const { ids, enabled } = c.req.valid('json');
    const count = await batchSetAlertEnabled(ids, enabled);
    return c.json(okBody(null, `已更新 ${count} 条预警状态`), 200);
  },
});

const evalRoute = defineContractRoute(reportAlertContract.evaluate, {
  responses: notFound,
  handler: async (c) => c.json(okBody(await submitAlertEvaluateTask(c.req.valid('param').id), '任务已提交，可在任务中心查看进度'), 200),
});

mountCrud(router, reportAlertContract,
  { list: listAlerts, get: getAlert, create: createAlert, update: updateAlert, remove: deleteAlert },
  {
    responses: { detail: notFound, update: notFound, remove: notFound },
  },
  [batchStatusRoute, evalRoute],
);

export default router;
