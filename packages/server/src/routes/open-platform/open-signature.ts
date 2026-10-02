import { OpenAPIHono } from '@hono/zod-openapi';
import { openSignatureContract } from '@arcbase/shared/open-platform';
import { defineContractRoute } from '../../lib/contract-route';
import { validationHook, okBody } from '../../lib/openapi-schemas';
import { getSignatureAlgorithmDoc, verifyAppSignature } from '../../services/open-platform/open-signature.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const algorithm = defineContractRoute(openSignatureContract.algorithm, {
  handler: (c) => c.json(okBody(getSignatureAlgorithmDoc()), 200),
});

const verify = defineContractRoute(openSignatureContract.verify, {
  handler: async (c) => c.json(okBody(await verifyAppSignature(c.req.valid('json'))), 200),
});

router.openapiRoutes([algorithm, verify] as const);

export default router;
