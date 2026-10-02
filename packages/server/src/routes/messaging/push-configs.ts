/**
 * App 推送配置（管理侧）。
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { pushConfigContract } from '@arcbase/shared/messaging';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  createPushConfig,
  deletePushConfig,
  getPushConfig,
  listPushConfigs,
  testPushSend,
  updatePushConfig,
} from '../../services/messaging/push-configs.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

const testSendRoute = defineContractRoute(pushConfigContract.testSend, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await testPushSend(id, c.req.valid('json')), '发送成功'), 200);
  },
});

mountCrud(router, pushConfigContract,
  {
    list: listPushConfigs,
    get: getPushConfig,
    create: createPushConfig,
    update: updatePushConfig,
    remove: deletePushConfig,
  },
  {},
  [testSendRoute],
);

export default router;
