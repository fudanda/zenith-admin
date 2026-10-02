import { OpenAPIHono } from '@hono/zod-openapi';
import { userAiConfigContract } from '@arcbase/shared/ai';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  getUserAiConfigs,
  createUserAiConfig,
  updateUserAiConfig,
  deleteUserAiConfig,
} from '../../services/ai/user-ai-config.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

const updateConfig = defineContractRoute(userAiConfigContract.update, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await updateUserAiConfig(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteConfig = defineContractRoute(userAiConfigContract.remove, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await deleteUserAiConfig(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

mountCrud(router, userAiConfigContract,
  { create: createUserAiConfig, list: getUserAiConfigs },
  { exclude: ['update', 'remove'] },
  [updateConfig, deleteConfig],
);

export default router;
