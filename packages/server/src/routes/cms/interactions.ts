import { OpenAPIHono } from '@hono/zod-openapi';
import { cmsInteractionContract } from '@arcbase/shared/cms';
import { setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  copyCmsInteraction,
  createCmsInteraction,
  deleteCmsInteraction,
  getCmsInteraction,
  getCmsInteractionCrossStats,
  getCmsInteractionStats,
  getCmsInteractionTrend,
  listCmsInteractionResponses,
  listCmsInteractionTexts,
  listCmsInteractions,
  setCmsInteractionStatus,
  updateCmsInteraction,
} from '../../services/cms/cms-interactions.service';
import { submitCmsInteractionBatchStatusTask } from '../../services/cms/cms-stage4-tasks';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

const responseListRoute = defineContractRoute(cmsInteractionContract.responses, {
  handler: async (c) => c.json(okBody(await listCmsInteractionResponses(c.req.valid('query'))), 200),
});
const statsRoute = defineContractRoute(cmsInteractionContract.stats, {
  handler: async (c) => c.json(okBody(await getCmsInteractionStats(c.req.valid('param').id)), 200),
});

const textsRoute = defineContractRoute(cmsInteractionContract.texts, {
  handler: async (c) => c.json(okBody(await listCmsInteractionTexts({
    interactionId: c.req.valid('param').id,
    ...c.req.valid('query'),
  })), 200),
});

const crossStatsRoute = defineContractRoute(cmsInteractionContract.crossStats, {
  handler: async (c) => {
    const { xQuestionId, yQuestionId } = c.req.valid('query');
    return c.json(okBody(await getCmsInteractionCrossStats(c.req.valid('param').id, xQuestionId, yQuestionId)), 200);
  },
});

const trendRoute = defineContractRoute(cmsInteractionContract.trend, {
  handler: async (c) => c.json(
    okBody(await getCmsInteractionTrend(c.req.valid('param').id, c.req.valid('query').days)),
    200,
  ),
});
const updateRouteDef = defineContractRoute(cmsInteractionContract.update, {
  handler: async (c) => {
    const id = c.req.valid('param').id;
    setAuditBeforeData(c, await getCmsInteraction(id));
    return c.json(okBody(await updateCmsInteraction(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const statusRoute = defineContractRoute(cmsInteractionContract.setStatus, {
  handler: async (c) => {
    const id = c.req.valid('param').id;
    setAuditBeforeData(c, await getCmsInteraction(id));
    return c.json(okBody(await setCmsInteractionStatus(id, c.req.valid('json').status), '状态已更新'), 200);
  },
});

const batchStatusRoute = defineContractRoute(cmsInteractionContract.batchStatus, {
  handler: async (c) => c.json(okBody(
    await submitCmsInteractionBatchStatusTask(c.req.valid('json')),
    '批量任务已提交',
  ), 200),
});

const copyRoute = defineContractRoute(cmsInteractionContract.copy, {
  handler: async (c) => c.json(okBody(await copyCmsInteraction(c.req.valid('param').id), '复制成功'), 200),
});

const deleteRouteDef = defineContractRoute(cmsInteractionContract.remove, {
  handler: async (c) => {
    const id = c.req.valid('param').id;
    setAuditBeforeData(c, await getCmsInteraction(id));
    await deleteCmsInteraction(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

mountCrud(router, cmsInteractionContract,
  { list: listCmsInteractions, get: getCmsInteraction, create: createCmsInteraction },
  {
    exclude: ['update', 'remove'],
  },
  [
    responseListRoute,
    batchStatusRoute,
    textsRoute,
    crossStatsRoute,
    trendRoute,
    statsRoute,
    updateRouteDef,
    statusRoute,
    copyRoute,
    deleteRouteDef,
  ],
);

export default router;
