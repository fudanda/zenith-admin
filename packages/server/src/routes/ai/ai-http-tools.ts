import { OpenAPIHono } from '@hono/zod-openapi';
import { aiHttpToolContract } from '@arcbase/shared/ai';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { listHttpTools, createHttpTool, updateHttpTool, deleteHttpTool } from '../../services/ai/ai-http-tools.service';
import { listAvailableTools } from '../../lib/ai/tools';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

/** 智能体编辑器工具勾选用：内置 + HTTP 工具统一视图，登录即可读 */
const available = defineContractRoute(aiHttpToolContract.all, {
  handler: async (c) => c.json(okBody(await listAvailableTools()), 200),
});
const update = defineContractRoute(aiHttpToolContract.update, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await updateHttpTool(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const remove = defineContractRoute(aiHttpToolContract.remove, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await deleteHttpTool(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

mountCrud(router, aiHttpToolContract,
  { create: createHttpTool, list: listHttpTools },
  {
    exclude: ['update', 'remove'],
  },
  [available, update, remove],
);

export default router;
