import { OpenAPIHono } from '@hono/zod-openapi';
import { reportSubscriptionContract } from '@arcbase/shared/report';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listSubscriptions,
  createSubscription,
  updateSubscription,
  deleteSubscription,
  ensureSubscriptionExists,
  mapSubscription,
  batchSetSubscriptionEnabled,
} from '../../services/report/report-subscription.service';
import { submitSubscriptionDeliveryTask } from '../../services/report/report-delivery-tasks';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

const notFound = { 404: { content: jsonContent(ErrorResponse), description: '不存在' } } as const;
const batchStatusRoute = defineContractRoute(reportSubscriptionContract.batchStatus, {
  handler: async (c) => {
    const { ids, enabled } = c.req.valid('json');
    const count = await batchSetSubscriptionEnabled(ids, enabled);
    return c.json(okBody(null, `已更新 ${count} 条订阅状态`), 200);
  },
});

const runRoute = defineContractRoute(reportSubscriptionContract.run, {
  responses: notFound,
  handler: async (c) => c.json(okBody(await submitSubscriptionDeliveryTask(c.req.valid('param').id), '任务已提交，可在任务中心查看进度'), 200),
});

mountCrud(router, reportSubscriptionContract,
  {
    list: listSubscriptions,
    get: async (id: number) => mapSubscription(await ensureSubscriptionExists(id)),
    create: createSubscription,
    update: updateSubscription,
    remove: deleteSubscription,
  },
  {
    responses: { update: notFound, remove: notFound },
  },
  [batchStatusRoute, runRoute],
);

export default router;
