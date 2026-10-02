import { OpenAPIHono } from '@hono/zod-openapi';
import { decisionTableContract } from '@arcbase/shared/rules';
import { setAuditBeforeData } from '../../middleware/guard';
import { sensitiveRateLimit } from '../../middleware/rate-limit';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listDecisionTables,
  getDecisionTable,
  getDecisionTableBeforeAudit,
  createDecisionTable,
  updateDecisionTable,
  deleteDecisionTable,
  deleteDecisionTables,
  publishDecisionTable,
  listDecisionTableVersions,
  evaluateDecisionTableByKey,
  testEvaluateDecisionTable,
  diffDecisionTableVersions,
  rollbackDecisionTable,
  toggleDecisionTable,
  listDecisionTableUsages,
  listTestCases,
  createTestCase,
  updateTestCase,
  deleteTestCase,
  runTestCases,
  getDecisionTableStats,
  shadowRunDecisionTable,
  submitDecisionTableReview,
  reviewDecisionTable,
  grayActionDecisionTable,
  simulateDecisionTable,
} from '../../services/platform/rules.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

const versionsRoute = defineContractRoute(decisionTableContract.versions, {
  handler: async (c) => c.json(okBody(await listDecisionTableVersions(c.req.valid('param').id)), 200),
});

const diffRoute = defineContractRoute(decisionTableContract.diff, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { from, to } = c.req.valid('query');
    return c.json(okBody(await diffDecisionTableVersions(id, from, to)), 200);
  },
});

const rollbackRoute = defineContractRoute(decisionTableContract.rollback, {
  handler: async (c) => {
    const { id, version } = c.req.valid('param');
    return c.json(okBody(await rollbackDecisionTable(id, version), '回滚成功'), 200);
  },
});

const usagesRoute = defineContractRoute(decisionTableContract.usages, {
  handler: async (c) => c.json(okBody(await listDecisionTableUsages(c.req.valid('param').id)), 200),
});

const casesRoute = defineContractRoute(decisionTableContract.cases, {
  handler: async (c) => c.json(okBody(await listTestCases(c.req.valid('param').id)), 200),
});

const caseCreateRoute = defineContractRoute(decisionTableContract.createCase, {
  handler: async (c) => c.json(okBody(await createTestCase(c.req.valid('param').id, c.req.valid('json')), '创建成功'), 200),
});

const caseRunRoute = defineContractRoute(decisionTableContract.runCases, {
  handler: async (c) => c.json(okBody(await runTestCases(c.req.valid('param').id)), 200),
});

const caseUpdateRoute = defineContractRoute(decisionTableContract.updateCase, {
  handler: async (c) => {
    const { id, caseId } = c.req.valid('param');
    return c.json(okBody(await updateTestCase(id, caseId, c.req.valid('json')), '更新成功'), 200);
  },
});

const caseDeleteRoute = defineContractRoute(decisionTableContract.removeCase, {
  handler: async (c) => {
    const { id, caseId } = c.req.valid('param');
    await deleteTestCase(id, caseId);
    return c.json(okBody(null, '删除成功'), 200);
  },
});
const publishRoute = defineContractRoute(decisionTableContract.publish, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const gray = body.grayPercent != null ? { grayPercent: body.grayPercent, grayDimension: body.grayDimension ?? null } : undefined;
    return c.json(okBody(await publishDecisionTable(id, { gray }), gray ? `已灰度发布（${gray.grayPercent}% 流量）` : '发布成功'), 200);
  },
});

const grayActionRoute = defineContractRoute(decisionTableContract.grayAction, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { action } = c.req.valid('json');
    return c.json(okBody(await grayActionDecisionTable(id, action), action === 'complete' ? '灰度已转正，新版本全量生效' : '已放弃灰度，全量回到旧版本'), 200);
  },
});

const simulateRoute = defineContractRoute(decisionTableContract.simulate, {
  handler: async (c) => c.json(okBody(await simulateDecisionTable(c.req.valid('param').id, c.req.valid('json').rows)), 200),
});

const toggleRoute = defineContractRoute(decisionTableContract.toggle, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { enabled } = c.req.valid('json');
    const before = await getDecisionTableBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await toggleDecisionTable(id, enabled), enabled ? '已启用' : '已停用'), 200);
  },
});

const statsRoute = defineContractRoute(decisionTableContract.stats, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await getDecisionTableStats(id, c.req.valid('query').days)), 200);
  },
});

const shadowRunRoute = defineContractRoute(decisionTableContract.shadowRun, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await shadowRunDecisionTable(id, c.req.valid('json').limit)), 200);
  },
});

const submitReviewRoute = defineContractRoute(decisionTableContract.submitReview, {
  handler: async (c) => c.json(okBody(await submitDecisionTableReview(c.req.valid('param').id), '已提交审批'), 200),
});

const reviewRoute = defineContractRoute(decisionTableContract.review, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { approve, comment } = c.req.valid('json');
    return c.json(okBody(await reviewDecisionTable(id, approve, comment), approve ? '已批准并发布' : '已驳回'), 200);
  },
});

const testRoute = defineContractRoute(decisionTableContract.test, {
  handler: async (c) => c.json(okBody(await testEvaluateDecisionTable(c.req.valid('param').id, c.req.valid('json').input)), 200),
});

const evaluateRoute = defineContractRoute(decisionTableContract.evaluate, {
  middleware: [sensitiveRateLimit],
  handler: async (c) => {
    const b = c.req.valid('json');
    return c.json(okBody(await evaluateDecisionTableByKey(b.key, b.input)), 200);
  },
});

mountCrud(router, decisionTableContract,
  {
    list: listDecisionTables,
    get: getDecisionTable,
    create: createDecisionTable,
    update: updateDecisionTable,
    remove: deleteDecisionTable,
    removeMany: deleteDecisionTables,
  },
  { messages: { removeBatch: '删除成功' } },
  [
    versionsRoute,
    diffRoute,
    rollbackRoute,
    usagesRoute,
    statsRoute,
    shadowRunRoute,
    submitReviewRoute,
    reviewRoute,
    casesRoute,
    caseCreateRoute,
    caseRunRoute,
    caseUpdateRoute,
    caseDeleteRoute,
    publishRoute,
    grayActionRoute,
    simulateRoute,
    toggleRoute,
    testRoute,
    evaluateRoute,
  ],
);

export default router;
