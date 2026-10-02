import { OpenAPIHono } from '@hono/zod-openapi';
import { cmsTelemetryAdminContract } from '@arcbase/shared/cms';
import { defineContractRoute } from '../../lib/contract-route';
import { validationHook, okBody } from '../../lib/openapi-schemas';
import { configureCmsTelemetry } from '../../services/cms/cms-telemetry.service';
const router = new OpenAPIHono({ defaultHook: validationHook });
router.openapiRoutes([defineContractRoute(cmsTelemetryAdminContract.configure, {
  handler: async c => c.json(okBody(await configureCmsTelemetry(c.req.valid('param').id, c.req.valid('json'))), 200),
})]);
export default router;
