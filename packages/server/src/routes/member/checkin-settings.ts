import { OpenAPIHono } from '@hono/zod-openapi';
import { checkinSettingsContract } from '@arcbase/shared/member';
import { setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { getCheckinSettings, updateCheckinSettings, getCheckinSettingsBeforeAudit } from '../../services/member/checkin-settings.service';

const checkinSettingsRouter = new OpenAPIHono({ defaultHook: validationHook });

const getRoute = defineContractRoute(checkinSettingsContract.get, {
  handler: async (c) => c.json(okBody(await getCheckinSettings()), 200),
});

const updateRoute = defineContractRoute(checkinSettingsContract.update, {
  handler: async (c) => {
    setAuditBeforeData(c, await getCheckinSettingsBeforeAudit());
    return c.json(okBody(await updateCheckinSettings(c.req.valid('json')), '更新成功'), 200);
  },
});

checkinSettingsRouter.openapiRoutes([getRoute, updateRoute] as const);

export default checkinSettingsRouter;
