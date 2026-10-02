/**
 * 交易投诉/争议管理路由。
 * 工单列表/详情/统计、商户回复、完结、投诉退款（复用退款审批链路）、模拟投诉（演示）。
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { paymentDisputeContract } from '@arcbase/shared/payment';
import { setAuditBeforeData } from '../../middleware/guard';
import { idempotencyGuard } from '../../middleware/idempotency';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  ensureDispute,
  getDisputeDetail,
  getDisputeStats,
  listDisputes,
  refundDispute,
  replyDispute,
  resolveDispute,
  simulateDispute,
} from '../../services/payment/payment-dispute.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

const statsRoute = defineContractRoute(paymentDisputeContract.stats, {
  handler: async (c) => c.json(okBody(await getDisputeStats()), 200),
});

const replyRoute = defineContractRoute(paymentDisputeContract.reply, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await ensureDispute(id));
    return c.json(okBody(await replyDispute(id, c.req.valid('json').content), '回复成功'), 200);
  },
});

const resolveRoute = defineContractRoute(paymentDisputeContract.resolve, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await ensureDispute(id));
    return c.json(okBody(await resolveDispute(id, c.req.valid('json').remark), '已完结'), 200);
  },
});

const refundRoute = defineContractRoute(paymentDisputeContract.refund, {
  middleware: [idempotencyGuard({ ttlSeconds: 10 })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await ensureDispute(id));
    return c.json(okBody(await refundDispute(id, c.req.valid('json')), '退款已发起'), 200);
  },
});

const simulateRoute = defineContractRoute(paymentDisputeContract.simulate, {
  handler: async (c) => c.json(okBody(await simulateDispute(c.req.valid('json').orderNo), '模拟投诉已生成'), 200),
});

mountCrud(router, paymentDisputeContract,
  { list: listDisputes, get: getDisputeDetail },
  {},
  [statsRoute, replyRoute, resolveRoute, refundRoute, simulateRoute],
);

export default router;
