import { OpenAPIHono } from '@hono/zod-openapi';
import { oauthContract } from '@arcbase/shared/identity';
import { defineContractRoute } from '../../lib/contract-route';
import { validationHook, okBody } from '../../lib/openapi-schemas';
import { getClientInfo } from '../../lib/request-helpers';
import {
  listOAuthAccounts, listEnabledOAuthProviders, generateAuthUrl, generateBindAuthUrl, handleOAuthCallback,
  bindOAuthAccount, unbindOAuthAccount,
} from '../../services/identity/oauth.service';

const oauth = new OpenAPIHono({ defaultHook: validationHook });

const accountsRoute = defineContractRoute(oauthContract.accounts, {
  handler: async (c) => c.json(okBody(await listOAuthAccounts()), 200),
});

// 登录页据此决定是否渲染「其他方式登录」；必须注册在 GET /{provider} 之前，否则被当成 provider="providers"
const providersRoute = defineContractRoute(oauthContract.providers, {
  middleware: [] as const,
  handler: async (c) => c.json(okBody(await listEnabledOAuthProviders()), 200),
});

const authUrlRoute = defineContractRoute(oauthContract.authUrl, {
  middleware: [] as const,
  handler: async (c) => c.json(okBody(await generateAuthUrl(c.req.valid('param').provider)), 200),
});

const bindUrlRoute = defineContractRoute(oauthContract.bindUrl, {
  handler: async (c) => c.json(okBody(await generateBindAuthUrl(c.req.valid('param').provider)), 200),
});

const callbackRoute = defineContractRoute(oauthContract.callback, {
  middleware: [] as const,
  handler: async (c) => {
    const { provider } = c.req.valid('param');
    const body = c.req.valid('json');
    const result = await handleOAuthCallback(provider, body, getClientInfo(c));
    return c.json(okBody(result.data, result.message), 200);
  },
});

const bindRoute = defineContractRoute(oauthContract.bind, {
  handler: async (c) => {
    const { provider, code, state } = c.req.valid('json');
    await bindOAuthAccount(provider, code, state);
    return c.json(okBody(null, '绑定成功'), 200);
  },
});

const unbindRoute = defineContractRoute(oauthContract.unbind, {
  handler: async (c) => {
    await unbindOAuthAccount(c.req.valid('param').provider);
    return c.json(okBody(null, '已解绑'), 200);
  },
});

oauth.openapiRoutes([accountsRoute, providersRoute, authUrlRoute, bindUrlRoute, callbackRoute, bindRoute, unbindRoute] as const);

export default oauth;
