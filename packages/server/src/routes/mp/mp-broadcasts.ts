import { OpenAPIHono } from '@hono/zod-openapi';
import { mpBroadcastContract } from '@arcbase/shared/mp';
import { setAuditBeforeData } from '../../middleware/guard';
import { idempotencyGuard } from '../../middleware/idempotency';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  mpBroadcastService,
  sendMpBroadcast,
  getMpBroadcastBeforeAudit,
  previewMpBroadcast,
  getMpBroadcastResult,
} from '../../services/mp/mp-broadcast.service';
import { mountCrud } from '../_crud';

const mpBroadcastsRouter = new OpenAPIHono({ defaultHook: validationHook });

const sendRoute = defineContractRoute(mpBroadcastContract.send, {
  middleware: [idempotencyGuard({ ttlSeconds: 10 })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMpBroadcastBeforeAudit(id));
    return c.json(okBody(await sendMpBroadcast(id), '发送成功'), 200);
  },
});
const previewRoute = defineContractRoute(mpBroadcastContract.preview, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMpBroadcastBeforeAudit(id));
    await previewMpBroadcast(id, c.req.valid('json').openid);
    return c.json(okBody(null, '预览已发送'), 200);
  },
});

const resultRoute = defineContractRoute(mpBroadcastContract.result, {
  handler: async (c) => c.json(okBody(await getMpBroadcastResult(c.req.valid('param').id)), 200),
});

mountCrud(mpBroadcastsRouter, mpBroadcastContract,
  mpBroadcastService,
  { messages: { create: '已创建群发草稿' } },
  [sendRoute, previewRoute, resultRoute],
);

export default mpBroadcastsRouter;
