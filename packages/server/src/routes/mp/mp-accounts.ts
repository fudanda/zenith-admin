import { OpenAPIHono } from '@hono/zod-openapi';
import { mpAccountContract } from '@arcbase/shared/mp';
import { setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listMpAccounts,
  getMpAccount,
  createMpAccount,
  updateMpAccount,
  deleteMpAccount,
  setMpAccountDefault,
  testMpAccountConnection,
  getMpAccountDefaultAudit,
} from '../../services/mp/mp-account.service';
import { mountCrud } from '../_crud';

const mpAccountsRouter = new OpenAPIHono({ defaultHook: validationHook });

const setDefaultRoute = defineContractRoute(mpAccountContract.setDefault, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMpAccountDefaultAudit(id));
    const updated = await setMpAccountDefault(id);
    setAuditAfterData(c, await getMpAccountDefaultAudit(id));
    return c.json(okBody(updated, '操作成功'), 200);
  },
});

const testConnectionRoute = defineContractRoute(mpAccountContract.testConnection, {
  handler: async (c) => c.json(okBody(await testMpAccountConnection(c.req.valid('param').id), '连接成功'), 200),
});

mountCrud(mpAccountsRouter, mpAccountContract,
  {
    list: listMpAccounts,
    get: getMpAccount,
    create: createMpAccount,
    update: updateMpAccount,
    remove: deleteMpAccount,
  },
  {},
  [setDefaultRoute, testConnectionRoute],
);

export default mpAccountsRouter;
