import { OpenAPIHono } from '@hono/zod-openapi';
import { reportDqContract } from '@arcbase/shared/report';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  createReportDqRule,
  deleteReportDqRule,
  getCurrentReportDqScore,
  getReportDqRule,
  listReportDqAnomalies,
  listReportDqRules,
  listReportDqRuns,
  listReportDqScores,
  submitReportDqRuleRun,
  toggleReportDqRule,
  updateReportDqAnomalyStatus,
  updateReportDqRule,
} from '../../services/report/report-dq.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRulesRoute = defineContractRoute(reportDqContract.rules, {
  handler: async (c) => c.json(okBody(await listReportDqRules(c.req.valid('query'))), 200),
});

const getRuleRoute = defineContractRoute(reportDqContract.ruleDetail, {
  handler: async (c) => c.json(okBody(await getReportDqRule(c.req.valid('param').id)), 200),
});

const createRuleRoute = defineContractRoute(reportDqContract.createRule, {
  handler: async (c) => c.json(okBody(await createReportDqRule(c.req.valid('json')), '创建成功'), 200),
});

const updateRuleRoute = defineContractRoute(reportDqContract.updateRule, {
  handler: async (c) => c.json(okBody(await updateReportDqRule(c.req.valid('param').id, c.req.valid('json')), '更新成功'), 200),
});

const deleteRuleRoute = defineContractRoute(reportDqContract.removeRule, {
  handler: async (c) => {
    await deleteReportDqRule(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const toggleRuleRoute = defineContractRoute(reportDqContract.toggleRule, {
  handler: async (c) => c.json(okBody(await toggleReportDqRule(c.req.valid('param').id), '操作成功'), 200),
});

const runRuleRoute = defineContractRoute(reportDqContract.runRule, {
  handler: async (c) => c.json(okBody(await submitReportDqRuleRun(c.req.valid('param').id, c.req.valid('json')), '任务已提交'), 200),
});

const listRunsRoute = defineContractRoute(reportDqContract.runs, {
  handler: async (c) => c.json(okBody(await listReportDqRuns(c.req.valid('query'))), 200),
});

const scoreHistoryRoute = defineContractRoute(reportDqContract.scores, {
  handler: async (c) => c.json(okBody(await listReportDqScores(c.req.valid('param').id, c.req.valid('query'))), 200),
});

const currentScoreRoute = defineContractRoute(reportDqContract.currentScore, {
  handler: async (c) => c.json(okBody(await getCurrentReportDqScore(c.req.valid('param').id)), 200),
});

const listAnomaliesRoute = defineContractRoute(reportDqContract.anomalies, {
  handler: async (c) => c.json(okBody(await listReportDqAnomalies(c.req.valid('query'))), 200),
});

const anomalyStatusRoute = defineContractRoute(reportDqContract.updateAnomalyStatus, {
  handler: async (c) => c.json(okBody(await updateReportDqAnomalyStatus(c.req.valid('param').id, c.req.valid('json')), '操作成功'), 200),
});

router.openapiRoutes([
  listRulesRoute, getRuleRoute, createRuleRoute, updateRuleRoute, deleteRuleRoute, toggleRuleRoute,
  runRuleRoute, listRunsRoute, scoreHistoryRoute, currentScoreRoute, listAnomaliesRoute, anomalyStatusRoute,
] as const);

export default router;
