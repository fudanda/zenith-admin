import { OpenAPIHono } from '@hono/zod-openapi';
import { cmsChannelContract } from '@arcbase/shared/cms';
import { setAuditBeforeData, setAuditAfterData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { validationHook, okBody } from '../../lib/openapi-schemas';
import {
  listCmsChannelTree,
  getCmsChannel,
  createCmsChannel,
  updateCmsChannel,
  deleteCmsChannel,
  mergeCmsChannels,
  clearCmsChannel,
  batchCreateCmsChannels,
  getCmsChannelUsers,
  setCmsChannelUsers,
} from '../../services/cms/cms-channels.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

const treeRoute = defineContractRoute(cmsChannelContract.tree, {
  handler: async (c) => c.json(okBody(await listCmsChannelTree(c.req.valid('query'))), 200),
});
// ─── 栏目运维：合并 / 清空 / 批量新增 ─────────────────────────────────────────
const mergeRoute = defineContractRoute(cmsChannelContract.merge, {
  handler: async (c) => {
    const { sourceIds, targetId } = c.req.valid('json');
    const count = await mergeCmsChannels(sourceIds, targetId);
    return c.json(okBody(null, `合并完成，已迁移 ${count} 条内容`), 200);
  },
});

const clearRoute = defineContractRoute(cmsChannelContract.clear, {
  handler: async (c) => {
    const count = await clearCmsChannel(c.req.valid('param').id);
    return c.json(okBody(null, `已将 ${count} 条内容移入回收站`), 200);
  },
});

const batchCreateRoute = defineContractRoute(cmsChannelContract.batchCreate, {
  handler: async (c) => {
    const { siteId, parentId, names, slugStrategy } = c.req.valid('json');
    const count = await batchCreateCmsChannels(siteId, parentId, names, slugStrategy);
    return c.json(okBody(null, `已创建 ${count} 个栏目`), 200);
  },
});

// ─── 栏目授权用户（栏目级数据权限：绑定后仅授权用户可管理该栏目下内容）─────────
const getChannelUsersRoute = defineContractRoute(cmsChannelContract.users, {
  handler: async (c) => c.json(okBody(await getCmsChannelUsers(c.req.valid('param').id)), 200),
});

const setChannelUsersRoute = defineContractRoute(cmsChannelContract.setUsers, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { userIds } = c.req.valid('json');
    setAuditBeforeData(c, await getCmsChannelUsers(id));
    const after = await setCmsChannelUsers(id, userIds);
    setAuditAfterData(c, after);
    return c.json(okBody(null, '保存成功'), 200);
  },
});

mountCrud(router, cmsChannelContract,
  { get: getCmsChannel, create: createCmsChannel, update: updateCmsChannel, remove: deleteCmsChannel },
  {},
  [treeRoute, mergeRoute, clearRoute, batchCreateRoute, getChannelUsersRoute, setChannelUsersRoute],
);

export default router;
