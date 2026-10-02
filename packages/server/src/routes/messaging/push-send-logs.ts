/**
 * App 推送发送记录（管理侧只读）。
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { pushSendLogContract } from '@arcbase/shared/messaging';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { getPushSendLogStats, listPushSendLogs } from '../../services/messaging/push-send-logs.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

const statsRoute = defineContractRoute(pushSendLogContract.stats, {
  handler: async (c) => c.json(okBody(await getPushSendLogStats(c.req.valid('query').days)), 200),
});

mountCrud(router, pushSendLogContract,
  { list: listPushSendLogs },
  {},
  [statsRoute],
);

export default router;
