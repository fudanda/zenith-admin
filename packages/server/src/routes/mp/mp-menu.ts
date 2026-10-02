import { OpenAPIHono } from '@hono/zod-openapi';
import { mpMenuContract } from '@arcbase/shared/mp';
import { setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { getMpMenu, saveMpMenu, publishMpMenu, pullMpMenu, deleteMpMenu } from '../../services/mp/mp-menu.service';

const mpMenuRouter = new OpenAPIHono({ defaultHook: validationHook });

const getRoute = defineContractRoute(mpMenuContract.get, {
  handler: async (c) => c.json(okBody(await getMpMenu(c.req.valid('query').accountId)), 200),
});

const saveRoute = defineContractRoute(mpMenuContract.save, {
  handler: async (c) => {
    const { accountId, buttons } = c.req.valid('json');
    setAuditBeforeData(c, await getMpMenu(accountId));
    return c.json(okBody(await saveMpMenu(accountId, buttons), '保存成功'), 200);
  },
});

const publishRoute = defineContractRoute(mpMenuContract.publish, {
  handler: async (c) => {
    const { accountId } = c.req.valid('json');
    setAuditBeforeData(c, await getMpMenu(accountId));
    return c.json(okBody(await publishMpMenu(accountId), '发布成功'), 200);
  },
});

const pullRoute = defineContractRoute(mpMenuContract.pull, {
  handler: async (c) => {
    const { accountId } = c.req.valid('json');
    setAuditBeforeData(c, await getMpMenu(accountId));
    return c.json(okBody(await pullMpMenu(accountId), '拉取成功'), 200);
  },
});

const deleteRoute = defineContractRoute(mpMenuContract.remove, {
  handler: async (c) => {
    const { accountId } = c.req.valid('json');
    setAuditBeforeData(c, await getMpMenu(accountId));
    return c.json(okBody(await deleteMpMenu(accountId), '删除成功'), 200);
  },
});

mpMenuRouter.openapiRoutes([getRoute, saveRoute, publishRoute, pullRoute, deleteRoute] as const);

export default mpMenuRouter;
