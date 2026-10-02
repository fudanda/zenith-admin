/**
 * 运营群发路由（管理员）。发送动作提交任务中心任务，进度经任务中心查询。
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { broadcastContract } from '@arcbase/shared/messaging';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  createBroadcast,
  deleteBroadcast,
  getBroadcast,
  listBroadcasts,
  sendBroadcast,
  updateBroadcast,
} from '../../services/messaging/broadcasts.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

const sendRoute = defineContractRoute(broadcastContract.send, {
  handler: async (c) => c.json(okBody(await sendBroadcast(c.req.valid('param').id), '任务已提交'), 200),
});

mountCrud(router, broadcastContract,
  {
    list: listBroadcasts,
    get: getBroadcast,
    create: createBroadcast,
    update: updateBroadcast,
    remove: deleteBroadcast,
  },
  {},
  [sendRoute],
);

export default router;
