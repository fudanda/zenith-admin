import { OpenAPIHono } from '@hono/zod-openapi';
import { oauthConfigContract, type OAuthProviderType } from '@arcbase/shared/identity';
import { setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { validationHook, okBody } from '../../lib/openapi-schemas';
import { listOauthConfigs, updateOauthConfig, getOauthConfigBeforeAudit } from '../../services/identity/oauth-config.service';

const oauthConfigRouter = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineContractRoute(oauthConfigContract.list, {
  handler: async (c) => c.json(okBody(await listOauthConfigs(), 'success'), 200),
});

const updateRoute = defineContractRoute(oauthConfigContract.update, {
  handler: async (c) => {
    const provider = c.req.valid('param').provider as OAuthProviderType;
    const before = await getOauthConfigBeforeAudit(provider);
    if (before) setAuditBeforeData(c, before);
    const result = await updateOauthConfig(provider, c.req.valid('json'));
    return c.json(okBody(result, '保存成功'), 200);
  },
});

oauthConfigRouter.openapiRoutes([listRoute, updateRoute] as const);

export default oauthConfigRouter;
