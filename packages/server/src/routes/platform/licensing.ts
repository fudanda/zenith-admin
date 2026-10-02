import { OpenAPIHono } from '@hono/zod-openapi';
import { licensingContract } from '@arcbase/shared/licensing';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  getLicensingStatus,
  activateLicense,
  deactivateLicense,
  listLicenseEvents,
} from '../../services/platform/licensing.service';

const licensingRoute = new OpenAPIHono({ defaultHook: validationHook });

const statusRoute = defineContractRoute(licensingContract.status, {
  handler: async (c) => c.json(okBody(await getLicensingStatus()), 200),
});

const activateRoute = defineContractRoute(licensingContract.activate, {
  handler: async (c) => {
    const { envelope } = c.req.valid('json');
    const user = c.get('user');
    return c.json(okBody(await activateLicense(envelope, user?.userId ?? null), '激活成功'), 200);
  },
});

const deactivateRoute = defineContractRoute(licensingContract.deactivate, {
  handler: async (c) => {
    await deactivateLicense();
    return c.json(okBody(null, '已停用'), 200);
  },
});

const eventsRoute = defineContractRoute(licensingContract.events, {
  handler: async (c) => c.json(okBody(await listLicenseEvents(c.req.valid('query'))), 200),
});

licensingRoute.openapiRoutes([statusRoute, activateRoute, deactivateRoute, eventsRoute] as const);

export default licensingRoute;
