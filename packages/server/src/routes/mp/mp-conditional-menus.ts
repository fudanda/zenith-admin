import { OpenAPIHono } from '@hono/zod-openapi';
import { mpConditionalMenuContract } from '@arcbase/shared/mp';
import { setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listMpConditionalMenus,
  createMpConditionalMenu,
  updateMpConditionalMenu,
  deleteMpConditionalMenu,
  publishMpConditionalMenu,
  tryMatchMpMenu,
  getMpConditionalMenuBeforeAudit,
} from '../../services/mp/mp-conditional-menu.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineContractRoute(mpConditionalMenuContract.list, {
  handler: async (c) => c.json(okBody(await listMpConditionalMenus(c.req.valid('query').accountId)), 200),
});

const tryMatchRoute = defineContractRoute(mpConditionalMenuContract.tryMatch, {
  handler: async (c) => {
    const b = c.req.valid('json');
    return c.json(okBody(await tryMatchMpMenu(b.accountId, b.userId)), 200);
  },
});
const publishRoute = defineContractRoute(mpConditionalMenuContract.publish, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMpConditionalMenuBeforeAudit(id));
    return c.json(okBody(await publishMpConditionalMenu(id), '发布成功'), 200);
  },
});

mountCrud(router, mpConditionalMenuContract,
  {
    get: getMpConditionalMenuBeforeAudit,
    create: createMpConditionalMenu,
    update: updateMpConditionalMenu,
    remove: deleteMpConditionalMenu,
  },
  {
    exclude: ['list'],
  },
  [listRoute, tryMatchRoute, publishRoute],
);

export default router;
