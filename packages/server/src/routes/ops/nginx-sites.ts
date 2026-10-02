import { OpenAPIHono } from '@hono/zod-openapi';
import { nginxSiteContract } from '@arcbase/shared/ops';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import {
  getNginxInfo,
  listNginxSites,
  getNginxSiteDetail,
  createNginxSite,
  updateNginxSiteContent,
  deleteNginxSite,
  enableNginxSite,
  disableNginxSite,
  testNginxConfig,
  reloadNginx,
} from '../../services/ops/nginx-sites.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

const infoRoute = defineContractRoute(nginxSiteContract.info, {
  handler: async (c) => c.json(okBody(await getNginxInfo()), 200),
});

const testRoute = defineContractRoute(nginxSiteContract.test, {
  handler: async (c) => c.json(okBody(await testNginxConfig()), 200),
});

const reloadRoute = defineContractRoute(nginxSiteContract.reload, {
  handler: async (c) => {
    await reloadNginx();
    return c.json(okBody(null, 'Nginx 已重载'), 200);
  },
});

const detailRoute = defineContractRoute(nginxSiteContract.detail, {
  handler: async (c) => c.json(okBody(await getNginxSiteDetail(c.req.valid('param').name)), 200),
});

const createRouteDef = defineContractRoute(nginxSiteContract.create, {
  handler: async (c) => {
    const input = c.req.valid('json');
    await createNginxSite(input);
    setAuditAfterData(c, await getNginxSiteDetail(input.name));
    return c.json(okBody(null, '站点已创建'), 200);
  },
});

const updateRoute = defineContractRoute(nginxSiteContract.update, {
  handler: async (c) => {
    const { name } = c.req.valid('param');
    const { content } = c.req.valid('json');
    setAuditBeforeData(c, await getNginxSiteDetail(name));
    await updateNginxSiteContent(name, content);
    setAuditAfterData(c, await getNginxSiteDetail(name));
    return c.json(okBody(null, '配置已保存'), 200);
  },
});

const deleteRoute = defineContractRoute(nginxSiteContract.remove, {
  handler: async (c) => {
    const { name } = c.req.valid('param');
    setAuditBeforeData(c, await getNginxSiteDetail(name));
    await deleteNginxSite(name);
    setAuditAfterData(c, { name, deleted: true });
    return c.json(okBody(null, '站点已删除'), 200);
  },
});

const enableRoute = defineContractRoute(nginxSiteContract.enable, {
  handler: async (c) => {
    const { name } = c.req.valid('param');
    setAuditBeforeData(c, await getNginxSiteDetail(name));
    await enableNginxSite(name);
    setAuditAfterData(c, await getNginxSiteDetail(name));
    return c.json(okBody(null, '站点已启用'), 200);
  },
});

const disableRoute = defineContractRoute(nginxSiteContract.disable, {
  handler: async (c) => {
    const { name } = c.req.valid('param');
    setAuditBeforeData(c, await getNginxSiteDetail(name));
    await disableNginxSite(name);
    setAuditAfterData(c, await getNginxSiteDetail(name));
    return c.json(okBody(null, '站点已禁用'), 200);
  },
});

// 静态 /info /test /reload 先于动态 /{name} 注册
mountCrud(router, nginxSiteContract,
  { list: listNginxSites },
  { exclude: ['detail', 'create', 'update', 'remove'] },
  [
    infoRoute,
    testRoute,
    reloadRoute,
    detailRoute,
    createRouteDef,
    updateRoute,
    deleteRoute,
    enableRoute,
    disableRoute,
  ],
);

export default router;
