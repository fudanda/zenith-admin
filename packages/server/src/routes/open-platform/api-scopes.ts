import { OpenAPIHono } from '@hono/zod-openapi';
import { apiScopeContract } from '@arcbase/shared/open-platform';
import { defineContractRoute } from '../../lib/contract-route';
import { validationHook, okBody } from '../../lib/openapi-schemas';
import {
  listApiScopes,
  listEnabledApiScopes,
  batchDeleteApiScopes,
  apiScopeService,
} from '../../services/open-platform/api-scopes.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

const options = defineContractRoute(apiScopeContract.options, {
  handler: async (c) => c.json(okBody(await listEnabledApiScopes()), 200),
});
const batchDelete = defineContractRoute(apiScopeContract.removeBatch, {
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const n = await batchDeleteApiScopes(ids);
    return c.json(okBody(null, `已删除 ${n} 条记录`), 200);
  },
});

mountCrud(router, apiScopeContract,
  {
    list: listApiScopes,
    get: apiScopeService.get,
    create: apiScopeService.create,
    update: apiScopeService.update,
    remove: apiScopeService.remove,
  },
  {
    exclude: ['removeBatch'],
  },
  [options, batchDelete],
);

export default router;
