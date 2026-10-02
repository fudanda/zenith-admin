/**
 * 转账/代付管理路由。
 * 发起转账（微信零钱 / 支付宝账户）、四眼审批、查单同步、列表与汇总。
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { paymentTransferContract } from '@arcbase/shared/payment';
import { idempotencyGuard } from '../../middleware/idempotency';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  createTransfer,
  approveTransfer,
  getTransfer,
  getTransferSummary,
  listTransfers,
  rejectTransfer,
  syncTransferStatus,
} from '../../services/payment/payment-transfer.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });
const summaryRoute = defineContractRoute(paymentTransferContract.summary, {
  handler: async (c) => c.json(okBody(await getTransferSummary(c.req.valid('query'))), 200),
});
const createTransferRoute = defineContractRoute(paymentTransferContract.create, {
  middleware: [idempotencyGuard({ ttlSeconds: 15 })],
  handler: async (c) => c.json(okBody(await createTransfer({
    ...c.req.valid('json'),
    idempotencyKey: c.req.valid('header')['x-idempotency-key'],
  }), '转账已受理'), 200),
});

const approveRoute = defineContractRoute(paymentTransferContract.approve, {
  handler: async (c) => c.json(okBody(await approveTransfer(
    c.req.valid('param').id,
    c.req.valid('json'),
  ), '转账审批通过并已受理'), 200),
});

const rejectRoute = defineContractRoute(paymentTransferContract.reject, {
  handler: async (c) => c.json(okBody(await rejectTransfer(
    c.req.valid('param').id,
    c.req.valid('json'),
  ), '转账已驳回'), 200),
});

const queryRoute = defineContractRoute(paymentTransferContract.query, {
  handler: async (c) => c.json(okBody(await syncTransferStatus(c.req.valid('param').id), '查单完成'), 200),
});

mountCrud(router, paymentTransferContract,
  { list: listTransfers, get: getTransfer },
  { exclude: ['create'] },
  [summaryRoute, createTransferRoute, approveRoute, rejectRoute, queryRoute],
);

export default router;
