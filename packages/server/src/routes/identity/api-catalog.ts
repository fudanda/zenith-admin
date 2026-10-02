import { OpenAPIHono } from '@hono/zod-openapi';
import { apiCatalogContract } from '@arcbase/shared/identity';
import { defineContractRoute } from '../../lib/contract-route';
import { notModifiedResponse, okBody, validationHook } from '../../lib/openapi-schemas';
import { createStaticJsonResponder } from '../../lib/static-json-response';
import { getApiCatalog } from '../../services/identity/api-catalog.service';

const apiCatalogRouter = new OpenAPIHono({ defaultHook: validationHook });
const catalogResponse = createStaticJsonResponder(() => okBody(getApiCatalog()));

const getRoute = defineContractRoute(apiCatalogContract.get, {
  responses: notModifiedResponse,
  handler: (c) => catalogResponse.respond(c),
});

apiCatalogRouter.openapiRoutes([getRoute] as const);

export default apiCatalogRouter;
