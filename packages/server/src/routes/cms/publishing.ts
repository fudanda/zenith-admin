import { OpenAPIHono } from '@hono/zod-openapi';
import { cmsPublishingContract } from '@arcbase/shared/cms';
import { idempotencyGuard } from '../../middleware/idempotency';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  batchCmsPublishingAction,
  cmsPublishingAction,
  getCmsPublishingDetail,
  listCmsPublishArtifacts,
  listCmsPublishingTasks,
  submitCmsPublishTask,
  submitCmsSiteGroupPublish,
} from '../../services/cms/cms-publishing.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

const artifactsRoute = defineContractRoute(cmsPublishingContract.artifacts, {
  handler: async (c) => c.json(okBody(await listCmsPublishArtifacts(c.req.valid('query'))), 200),
});

const submitRoute = defineContractRoute(cmsPublishingContract.submit, {
  middleware: [idempotencyGuard({ ttlSeconds: 30 })],
  handler: async (c) => c.json(okBody(await submitCmsPublishTask(c.req.valid('json')), '发布任务已提交'), 200),
});

const groupSubmitRoute = defineContractRoute(cmsPublishingContract.groupSubmit, {
  middleware: [idempotencyGuard({ ttlSeconds: 30 })],
  handler: async (c) => c.json(okBody(
    await submitCmsSiteGroupPublish(c.req.valid('json')),
    '站群重建任务已提交',
  ), 200),
});

const batchActionRoute = defineContractRoute(cmsPublishingContract.batchAction, {
  handler: async (c) => {
    const { ids, action } = c.req.valid('json');
    return c.json(okBody(await batchCmsPublishingAction(ids, action), '批量操作完成'), 200);
  },
});

const actionRoute = defineContractRoute(cmsPublishingContract.action, {
  handler: async (c) => {
    const { id, action } = c.req.valid('param');
    return c.json(okBody(await cmsPublishingAction(id, action), '操作已提交'), 200);
  },
});

mountCrud(router, cmsPublishingContract,
  { list: listCmsPublishingTasks, get: getCmsPublishingDetail },
  {},
  [artifactsRoute, submitRoute, batchActionRoute, actionRoute, groupSubmitRoute],
);

export default router;
