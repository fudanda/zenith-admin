import { OpenAPIHono } from '@hono/zod-openapi';
import { cmsCommentContract } from '@arcbase/shared/cms';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listCmsComments,
  auditCmsComments,
  deleteCmsComments,
  countPendingComments,
} from '../../services/cms/cms-comments.service';
import { triggerContentStaticRefresh } from '../../services/cms/cms-static.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

const pendingCountRoute = defineContractRoute(cmsCommentContract.pendingCount, {
  handler: async (c) => c.json(okBody({ count: await countPendingComments(c.req.valid('query').siteId) }), 200),
});

const approveRoute = defineContractRoute(cmsCommentContract.approve, {
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const contentIds = await auditCmsComments(ids, 'approved');
    for (const contentId of contentIds) triggerContentStaticRefresh(contentId);
    return c.json(okBody(null, `已通过 ${ids.length} 条评论`), 200);
  },
});

const rejectRoute = defineContractRoute(cmsCommentContract.reject, {
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const contentIds = await auditCmsComments(ids, 'rejected');
    for (const contentId of contentIds) triggerContentStaticRefresh(contentId);
    return c.json(okBody(null, `已拒绝 ${ids.length} 条评论`), 200);
  },
});

const deleteRouteDef = defineContractRoute(cmsCommentContract.batchDelete, {
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const contentIds = await deleteCmsComments(ids);
    for (const contentId of contentIds) triggerContentStaticRefresh(contentId);
    return c.json(okBody(null, `已删除 ${ids.length} 条评论`), 200);
  },
});

mountCrud(router, cmsCommentContract,
  { list: listCmsComments },
  {},
  [pendingCountRoute, approveRoute, rejectRoute, deleteRouteDef],
);

export default router;
