import { OpenAPIHono } from '@hono/zod-openapi';
import { cmsFriendLinkContract } from '@arcbase/shared/cms';
import { setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { validationHook, okBody } from '../../lib/openapi-schemas';
import {
  listCmsFriendLinks,
  createCmsFriendLink,
  updateCmsFriendLink,
  deleteCmsFriendLink,
  ensureCmsFriendLinkExists,
  mapCmsFriendLink,
} from '../../services/cms/cms-friend-links.service';
import {
  listCmsFriendLinkGroups,
  listAllCmsFriendLinkGroups,
  createCmsFriendLinkGroup,
  updateCmsFriendLinkGroup,
  deleteCmsFriendLinkGroup,
  ensureCmsFriendLinkGroupExists,
  mapCmsFriendLinkGroup,
} from '../../services/cms/cms-friend-link-groups.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

// ─── 友链分组（独立子资源：/groups；置于 /{id} 之前避免路径冲突）─────────────────
const groupListRoute = defineContractRoute(cmsFriendLinkContract.groupList, {
  handler: async (c) => c.json(okBody(await listCmsFriendLinkGroups(c.req.valid('query'))), 200),
});

const groupAllRoute = defineContractRoute(cmsFriendLinkContract.groupAll, {
  handler: async (c) => c.json(okBody(await listAllCmsFriendLinkGroups(c.req.valid('query').siteId)), 200),
});

const groupCreateRoute = defineContractRoute(cmsFriendLinkContract.groupCreate, {
  handler: async (c) => c.json(okBody(await createCmsFriendLinkGroup(c.req.valid('json')), '创建成功'), 200),
});

const groupUpdateRoute = defineContractRoute(cmsFriendLinkContract.groupUpdate, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapCmsFriendLinkGroup(await ensureCmsFriendLinkGroupExists(id)));
    return c.json(okBody(await updateCmsFriendLinkGroup(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const groupDeleteRoute = defineContractRoute(cmsFriendLinkContract.groupRemove, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapCmsFriendLinkGroup(await ensureCmsFriendLinkGroupExists(id)));
    await deleteCmsFriendLinkGroup(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

mountCrud(router, cmsFriendLinkContract,
  {
    list: listCmsFriendLinks,
    get: async (id: number) => mapCmsFriendLink(await ensureCmsFriendLinkExists(id)),
    create: createCmsFriendLink,
    update: updateCmsFriendLink,
    remove: deleteCmsFriendLink,
  },
  {},
  [groupAllRoute, groupListRoute, groupCreateRoute, groupUpdateRoute, groupDeleteRoute],
);

export default router;
