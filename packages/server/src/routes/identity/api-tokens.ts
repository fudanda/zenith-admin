import { OpenAPIHono } from '@hono/zod-openapi';
import { apiTokenContract } from '@arcbase/shared/identity';
import { defineContractRoute } from '../../lib/contract-route';
import { validationHook, okBody } from '../../lib/openapi-schemas';
import { listApiTokens, createApiToken, deleteApiToken } from '../../services/identity/api-tokens.service';
import { mountCrud } from '../_crud';

const apiTokensRoute = new OpenAPIHono({ defaultHook: validationHook });
const deleteToken = defineContractRoute(apiTokenContract.remove, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await deleteApiToken(id);
    return c.json(okBody(null, 'Token 已撤销'), 200);
  },
});

mountCrud(apiTokensRoute, apiTokenContract,
  { create: createApiToken, list: listApiTokens },
  {
    messages: { create: 'Token 已创建，请务必复制保存，此后将无法再次查看完整 Token', remove: 'Token 已撤销' },
    exclude: ['remove'],
  },
  [deleteToken],
);

export default apiTokensRoute;
