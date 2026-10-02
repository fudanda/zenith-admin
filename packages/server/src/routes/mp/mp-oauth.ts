import { OpenAPIHono } from '@hono/zod-openapi';
import { mpOAuthContract } from '@arcbase/shared/mp';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { buildMpOAuthUrl } from '../../services/mp/mp-oauth.service';

const mpOAuthRouter = new OpenAPIHono({ defaultHook: validationHook });

const buildUrlRoute = defineContractRoute(mpOAuthContract.buildUrl, {
  handler: async (c) => c.json(okBody(await buildMpOAuthUrl(c.req.valid('json')), '生成成功'), 200),
});

mpOAuthRouter.openapiRoutes([buildUrlRoute] as const);

export default mpOAuthRouter;
