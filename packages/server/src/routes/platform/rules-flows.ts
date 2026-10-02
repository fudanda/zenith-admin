import { OpenAPIHono } from '@hono/zod-openapi';
import { decisionFlowContract } from '@arcbase/shared/rules';
import { sensitiveRateLimit } from '../../middleware/rate-limit';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  decisionFlowService,
  toggleDecisionFlow,
  publishDecisionFlow,
  testEvaluateDecisionFlow,
  evaluateDecisionFlowByKey,
  listDecisionFlowVersions,
  rollbackDecisionFlow,
} from '../../services/platform/rules-flow.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

const versionsRoute = defineContractRoute(decisionFlowContract.versions, {
  handler: async (c) => c.json(okBody(await listDecisionFlowVersions(c.req.valid('param').id)), 200),
});

const rollbackRoute = defineContractRoute(decisionFlowContract.rollback, {
  handler: async (c) => {
    const { id, version } = c.req.valid('param');
    return c.json(okBody(await rollbackDecisionFlow(id, version), '回滚成功'), 200);
  },
});
const publishRoute = defineContractRoute(decisionFlowContract.publish, {
  handler: async (c) => c.json(okBody(await publishDecisionFlow(c.req.valid('param').id), '发布成功'), 200),
});

const toggleRoute = defineContractRoute(decisionFlowContract.toggle, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { enabled } = c.req.valid('json');
    return c.json(okBody(await toggleDecisionFlow(id, enabled), enabled ? '已启用' : '已停用'), 200);
  },
});

const testRoute = defineContractRoute(decisionFlowContract.test, {
  handler: async (c) => c.json(okBody(await testEvaluateDecisionFlow(c.req.valid('param').id, c.req.valid('json').input)), 200),
});

const evaluateRoute = defineContractRoute(decisionFlowContract.evaluate, {
  middleware: [sensitiveRateLimit],
  handler: async (c) => {
    const b = c.req.valid('json');
    return c.json(okBody(await evaluateDecisionFlowByKey(b.key, b.input)), 200);
  },
});

mountCrud(router, decisionFlowContract,
  decisionFlowService,
  { messages: { removeBatch: '删除成功' } },
  [versionsRoute, rollbackRoute, publishRoute, toggleRoute, testRoute, evaluateRoute],
);

export default router;
