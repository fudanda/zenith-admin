import { OpenAPIHono } from '@hono/zod-openapi';
import { cmsDistributionContract } from '@arcbase/shared/cms';
import { setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { idempotencyGuard } from '../../middleware/idempotency';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  createCmsDistributionRule,
  deleteCmsDistributionRule,
  getCmsDistributionRule,
  getCmsDistributionRunDetail,
  listCmsDistributionRules,
  listCmsDistributionRuns,
  submitCmsDistributionRun,
  updateCmsDistributionRule,
} from '../../services/cms/cms-distributions.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

const runsRoute = defineContractRoute(cmsDistributionContract.runs, {
  handler: async (c) => c.json(okBody(await listCmsDistributionRuns(c.req.valid('query'))), 200),
});

const runDetailRoute = defineContractRoute(cmsDistributionContract.runDetail, {
  handler: async (c) => c.json(okBody(await getCmsDistributionRunDetail(c.req.valid('param').id)), 200),
});

const createRouteDef = defineContractRoute(cmsDistributionContract.create, {
  handler: async (c) => {
    const result = await createCmsDistributionRule(c.req.valid('json'));
    setAuditAfterData(c, result);
    return c.json(okBody(result, '分发规则已创建'), 200);
  },
});
const updateRoute = defineContractRoute(cmsDistributionContract.update, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getCmsDistributionRule(id));
    const result = await updateCmsDistributionRule(id, c.req.valid('json'));
    setAuditAfterData(c, result);
    return c.json(okBody(result, '分发规则已更新'), 200);
  },
});

const runRoute = defineContractRoute(cmsDistributionContract.run, {
  middleware: [idempotencyGuard({ ttlSeconds: 30 })],
  handler: async (c) => c.json(okBody(
    await submitCmsDistributionRun(c.req.valid('param').id),
    '分发任务已提交',
  ), 200),
});

mountCrud(router, cmsDistributionContract,
  { list: listCmsDistributionRules, get: getCmsDistributionRule, remove: deleteCmsDistributionRule },
  { exclude: ['create', 'update'] },
  [runsRoute, runDetailRoute, createRouteDef, runRoute, updateRoute],
);

export default router;
