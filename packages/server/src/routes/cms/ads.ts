import { OpenAPIHono } from '@hono/zod-openapi';
import { cmsAdContract } from '@arcbase/shared/cms';
import { setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listCmsAdSlots,
  createCmsAdSlot,
  updateCmsAdSlot,
  deleteCmsAdSlot,
  ensureCmsAdSlotExists,
  mapCmsAdSlot,
  listCmsAds,
  createCmsAd,
  updateCmsAd,
  deleteCmsAd,
  ensureCmsAdExists,
  mapCmsAd,
} from '../../services/cms/cms-ads.service';
import { getCmsAdEventStats, listCmsAdEvents } from '../../services/cms/cms-ad-events.service';
import { submitCmsAdEventCleanupTask } from '../../services/cms/cms-stage4-tasks';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

// ─── 广告位 ───────────────────────────────────────────────────────────────────
const listSlots = defineContractRoute(cmsAdContract.slots, {
  handler: async (c) => c.json(okBody(await listCmsAdSlots(c.req.valid('query').siteId)), 200),
});

const createSlot = defineContractRoute(cmsAdContract.slotCreate, {
  handler: async (c) => c.json(okBody(await createCmsAdSlot(c.req.valid('json')), '创建成功'), 200),
});

const updateSlot = defineContractRoute(cmsAdContract.slotUpdate, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapCmsAdSlot(await ensureCmsAdSlotExists(id)));
    return c.json(okBody(await updateCmsAdSlot(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteSlot = defineContractRoute(cmsAdContract.slotRemove, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapCmsAdSlot(await ensureCmsAdSlotExists(id)));
    await deleteCmsAdSlot(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});
const listEvents = defineContractRoute(cmsAdContract.events, {
  handler: async (c) => c.json(okBody(await listCmsAdEvents(c.req.valid('query'))), 200),
});

const eventStats = defineContractRoute(cmsAdContract.eventStats, {
  handler: async (c) => c.json(okBody(await getCmsAdEventStats(c.req.valid('query'))), 200),
});

const cleanupEvents = defineContractRoute(cmsAdContract.cleanupEvents, {
  handler: async (c) => c.json(okBody(
    await submitCmsAdEventCleanupTask(c.req.valid('json')),
    '清理任务已提交',
  ), 200),
});

mountCrud(router, cmsAdContract,
  {
    list: listCmsAds,
    get: async (id: number) => mapCmsAd(await ensureCmsAdExists(id)),
    create: createCmsAd,
    update: updateCmsAd,
    remove: deleteCmsAd,
  },
  {},
  [listSlots, createSlot, updateSlot, deleteSlot, listEvents, eventStats, cleanupEvents],
);

export default router;
