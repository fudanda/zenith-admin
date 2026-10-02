/**
 * 短链管理
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { shortLinkContract } from '@arcbase/shared/short-link';
import { defineContractRoute } from '../../lib/contract-route';
import { validationHook, okBody, errBody } from '../../lib/openapi-schemas';
import {
  createShortLink,
  deleteShortLinks,
  batchUpdateShortLinkStatus,
  ensureShortLink,
  shortLinkService,
} from '../../services/short-link/short-link.service';
import { getShortLinkStats } from '../../services/short-link/short-link-stats.service';
import { mountCrud } from '../_crud';

const shortLinksRouter = new OpenAPIHono({ defaultHook: validationHook });

// 静态 /batch 须早于 /{id} 注册
const batchDeleteRoute = defineContractRoute(shortLinkContract.removeBatch, {
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    if (!ids.length) return c.json(errBody('请选择要删除的记录'), 400);
    const deleted = await deleteShortLinks(ids);
    return c.json(okBody(null, `已删除 ${deleted} 条记录`), 200);
  },
});

const batchStatusRoute = defineContractRoute(shortLinkContract.batchUpdateStatus, {
  handler: async (c) => {
    const { ids, status } = c.req.valid('json');
    const updated = await batchUpdateShortLinkStatus(ids, status);
    return c.json(okBody(null, `已${status === 'enabled' ? '启用' : '禁用'} ${updated} 条记录`), 200);
  },
});

const ensureRoute = defineContractRoute(shortLinkContract.ensure, {
  handler: async (c) => c.json(okBody(await ensureShortLink(c.req.valid('json'))), 200),
});
const statsRoute = defineContractRoute(shortLinkContract.stats, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { days } = c.req.valid('query');
    return c.json(okBody(await getShortLinkStats(id, days)), 200);
  },
});

mountCrud(shortLinksRouter, shortLinkContract,
  {
    list: shortLinkService.list,
    get: shortLinkService.get,
    create: createShortLink,
    update: shortLinkService.update,
    remove: shortLinkService.remove,
  },
  { exclude: ['removeBatch'] },
  [batchDeleteRoute, batchStatusRoute, ensureRoute, statsRoute],
);

export default shortLinksRouter;
