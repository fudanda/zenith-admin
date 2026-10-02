import { OpenAPIHono } from '@hono/zod-openapi';
import { identityProviderContract } from '@arcbase/shared/identity';
import { defineContractRoute } from '../../lib/contract-route';
import { validationHook, okBody } from '../../lib/openapi-schemas';
import {
  createIdentityProvider,
  deleteIdentityProvider,
  getIdentityProvider,
  listIdentityProviders,
  searchIdentityProviderUsers,
  syncIdentityProviderUsers,
  testIdentityProviderConnection,
  updateIdentityProvider,
} from '../../services/identity/identity-providers.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

const testConnectionRoute = defineContractRoute(identityProviderContract.test, {
  handler: async (c) => c.json(okBody(await testIdentityProviderConnection(c.req.valid('param').id)), 200),
});

const searchDirectoryUsersRoute = defineContractRoute(identityProviderContract.ldapUsers, {
  handler: async (c) => c.json(okBody(await searchIdentityProviderUsers(c.req.valid('param').id, c.req.valid('query'))), 200),
});

const syncDirectoryUsersRoute = defineContractRoute(identityProviderContract.sync, {
  handler: async (c) => c.json(okBody(await syncIdentityProviderUsers(c.req.valid('param').id, c.req.valid('json')), '同步完成'), 200),
});

mountCrud(router, identityProviderContract,
  {
    list: listIdentityProviders,
    get: getIdentityProvider,
    create: createIdentityProvider,
    update: updateIdentityProvider,
    remove: deleteIdentityProvider,
  },
  {},
  [testConnectionRoute, searchDirectoryUsersRoute, syncDirectoryUsersRoute],
);

export default router;
