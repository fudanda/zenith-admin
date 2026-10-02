import { OpenAPIHono } from '@hono/zod-openapi';
import { bizPayDemoContract } from '@arcbase/shared/biz';
import { idempotencyGuard } from '../../middleware/idempotency';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { getClientIp } from '../../lib/request-helpers';
import {
  listBizPayDemos,
  getBizPayDemo,
  createBizPayDemo,
  deleteBizPayDemo,
  payBizPayDemo,
  simulateBizPayDemoPaid,
} from '../../services/payment/biz-pay-demo.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });
const payRoute = defineContractRoute(bizPayDemoContract.pay, {
  middleware: [idempotencyGuard({ ttlSeconds: 10, message: '下单处理中，请勿重复提交' })],
  handler: async (c) => c.json(okBody(await payBizPayDemo(c.req.valid('param').id, c.req.valid('json'), getClientIp(c)), '下单成功'), 200),
});

const simulateRoute = defineContractRoute(bizPayDemoContract.simulatePaid, {
  handler: async (c) => c.json(okBody(await simulateBizPayDemoPaid(c.req.valid('param').id), '已模拟支付成功'), 200),
});

mountCrud(router, bizPayDemoContract,
  { list: listBizPayDemos, get: getBizPayDemo, create: createBizPayDemo, remove: deleteBizPayDemo },
  { messages: { remove: '已删除' } },
  [payRoute, simulateRoute],
);

export default router;
