import { OpenAPIHono } from '@hono/zod-openapi';
import { smsConfigContract } from '@arcbase/shared/messaging';
import { setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listSmsConfigs,
  getSmsConfig,
  createSmsConfig,
  updateSmsConfig,
  deleteSmsConfig,
  getSmsConfigBeforeAudit,
  setSmsConfigDefault,
} from '../../services/messaging/sms-configs.service';
import { mountCrud } from '../_crud';

const smsConfigsRouter = new OpenAPIHono({ defaultHook: validationHook });

const setDefaultRoute = defineContractRoute(smsConfigContract.setDefault, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getSmsConfigBeforeAudit(id));
    return c.json(okBody(await setSmsConfigDefault(id), '操作成功'), 200);
  },
});

mountCrud(smsConfigsRouter, smsConfigContract,
  {
    list: listSmsConfigs,
    get: getSmsConfig,
    create: createSmsConfig,
    update: updateSmsConfig,
    remove: deleteSmsConfig,
  },
  {},
  [setDefaultRoute],
);

export default smsConfigsRouter;
