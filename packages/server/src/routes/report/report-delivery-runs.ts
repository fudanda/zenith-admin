import { OpenAPIHono } from '@hono/zod-openapi';
import { reportDeliveryRunContract } from '@arcbase/shared/report';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
import { acknowledgeAlertDeliveryRun, listAccessibleDeliveryRuns } from '../../services/report/report-delivery.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });
const ackRoute = defineContractRoute(reportDeliveryRunContract.acknowledge, {
  responses: { 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  handler: async (c) => c.json(okBody(await acknowledgeAlertDeliveryRun(c.req.valid('param').id, c.req.valid('json').note), '确认成功'), 200),
});

mountCrud(router, reportDeliveryRunContract,
  { list: listAccessibleDeliveryRuns },
  {},
  [ackRoute],
);

export default router;
