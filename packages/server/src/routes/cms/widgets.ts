import { OpenAPIHono } from '@hono/zod-openapi';
import { cmsWidgetContract } from '@arcbase/shared/cms';
import { setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  createCmsWidget,
  deleteCmsWidget,
  getCmsWidget,
  getCmsWidgetPreview,
  listCmsWidgetRefs,
  listCmsWidgetRenderersForSite,
  listCmsWidgetSlots,
  listCmsWidgetSourceReferences,
  listCmsWidgets,
  listPublishedCmsWidgets,
  offlineCmsWidget,
  publishCmsWidget,
  saveCmsWidgetSlot,
  updateCmsWidget,
} from '../../services/cms/cms-widgets.service';
import { submitCmsWidgetBatchTask } from '../../services/cms/cms-widget-tasks';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

const optionsRoute = defineContractRoute(cmsWidgetContract.options, {
  handler: async (c) => c.json(okBody(await listPublishedCmsWidgets(c.req.valid('query').siteId)), 200),
});

const renderersRoute = defineContractRoute(cmsWidgetContract.renderers, {
  handler: async (c) => {
    const { siteId, type } = c.req.valid('query');
    return c.json(okBody(await listCmsWidgetRenderersForSite(siteId, type)), 200);
  },
});

const slotsRoute = defineContractRoute(cmsWidgetContract.slots, {
  handler: async (c) => c.json(okBody(await listCmsWidgetSlots(c.req.valid('query').siteId)), 200),
});

const saveSlotRoute = defineContractRoute(cmsWidgetContract.saveSlot, {
  handler: async (c) => c.json(okBody(await saveCmsWidgetSlot(
    c.req.valid('param').slotKey,
    c.req.valid('json'),
  ), '主题插槽已更新'), 200),
});

const batchRoute = defineContractRoute(cmsWidgetContract.batch, {
  handler: async (c) => c.json(okBody(
    await submitCmsWidgetBatchTask(c.req.valid('json')),
    '批量任务已提交',
  ), 200),
});

const sourceRefsRoute = defineContractRoute(cmsWidgetContract.sourceRefs, {
  handler: async (c) => {
    const { sourceType, sourceId } = c.req.valid('query');
    return c.json(okBody(await listCmsWidgetSourceReferences(sourceType, sourceId)), 200);
  },
});
const refsRoute = defineContractRoute(cmsWidgetContract.refs, {
  handler: async (c) => c.json(okBody(await listCmsWidgetRefs(c.req.valid('param').id)), 200),
});

const previewRoute = defineContractRoute(cmsWidgetContract.preview, {
  handler: async (c) => c.json(okBody(await getCmsWidgetPreview(
    c.req.valid('param').id,
    c.req.valid('query').rendererKey,
  )), 200),
});
const publishRoute = defineContractRoute(cmsWidgetContract.publish, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getCmsWidget(id));
    return c.json(okBody(await publishCmsWidget(id), '发布成功，引用刷新任务已提交'), 200);
  },
});

const offlineRoute = defineContractRoute(cmsWidgetContract.offline, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getCmsWidget(id));
    return c.json(okBody(await offlineCmsWidget(id), '下线成功，引用刷新任务已提交'), 200);
  },
});

mountCrud(router, cmsWidgetContract,
  {
    list: listCmsWidgets,
    get: getCmsWidget,
    create: createCmsWidget,
    update: updateCmsWidget,
    remove: deleteCmsWidget,
  },
  {
    messages: { update: '保存成功' },
  },
  [
    optionsRoute,
    renderersRoute,
    slotsRoute,
    saveSlotRoute,
    batchRoute,
    sourceRefsRoute,
    refsRoute,
    previewRoute,
    publishRoute,
    offlineRoute,
  ],
);

export default router;
