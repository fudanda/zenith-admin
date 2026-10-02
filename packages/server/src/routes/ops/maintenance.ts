import { OpenAPIHono } from '@hono/zod-openapi';
import { maintenanceContract } from '@arcbase/shared/ops';
import { setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { validationHook, okBody } from '../../lib/openapi-schemas';
import { getMaintenanceStatus, updateMaintenanceStatus, listMaintenanceLogs } from '../../services/ops/maintenance.service';

const maintenanceRouter = new OpenAPIHono({ defaultHook: validationHook });

// 公开探测：全站维护遮罩与登录页在未登录状态下也要能读到
const statusRoute = defineContractRoute(maintenanceContract.status, {
  middleware: [],
  handler: async (c) => c.json(okBody(await getMaintenanceStatus()), 200),
});

const getRoute = defineContractRoute(maintenanceContract.detail, {
  handler: async (c) => c.json(okBody(await getMaintenanceStatus()), 200),
});

const updateRoute = defineContractRoute(maintenanceContract.update, {
  handler: async (c) => {
    const body = c.req.valid('json');
    setAuditBeforeData(c, await getMaintenanceStatus());
    const result = await updateMaintenanceStatus(body);
    return c.json(okBody(result), 200);
  },
});

const logsRoute = defineContractRoute(maintenanceContract.logs, {
  handler: async (c) => c.json(okBody(await listMaintenanceLogs(c.req.valid('query'))), 200),
});

maintenanceRouter.openapiRoutes([statusRoute, getRoute, updateRoute, logsRoute] as const);

export default maintenanceRouter;
