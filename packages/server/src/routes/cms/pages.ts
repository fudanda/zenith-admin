import { OpenAPIHono } from '@hono/zod-openapi';
import { cmsPageContract } from '@arcbase/shared/cms';
import { setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listCmsPages,
  getCmsPage,
  createCmsPage,
  updateCmsPage,
  deleteCmsPage,
} from '../../services/cms/cms-pages.service';
import { listCmsPageBlockAcls, setCmsPageBlockAcls } from '../../services/cms/cms-page-acl.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

const updateRouteDef = defineContractRoute(cmsPageContract.update, {
  // 页面编辑者可改元数据；区块 ACL 受托人也可进入本端点只改区块，
  // 逐区块能力与不可变排序规则由 service 执行
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getCmsPage(id);
    setAuditBeforeData(c, before);
    const row = await updateCmsPage(id, c.req.valid('json'));
    return c.json(okBody(row, '更新成功'), 200);
  },
});
const listBlockAclsRoute = defineContractRoute(cmsPageContract.blockAcls, {
  handler: async (c) => c.json(okBody(await listCmsPageBlockAcls(
    c.req.valid('param').id,
    c.req.valid('query').blockId,
  )), 200),
});

const setBlockAclsRoute = defineContractRoute(cmsPageContract.setBlockAcls, {
  handler: async (c) => {
    const pageId = c.req.valid('param').id;
    setAuditBeforeData(c, await listCmsPageBlockAcls(pageId));
    return c.json(okBody(await setCmsPageBlockAcls(pageId, c.req.valid('json')), '区块权限已更新'), 200);
  },
});

mountCrud(router, cmsPageContract,
  { list: listCmsPages, get: getCmsPage, create: createCmsPage, remove: deleteCmsPage },
  { exclude: ['update'] },
  [listBlockAclsRoute, setBlockAclsRoute, updateRouteDef],
);

export default router;
