import { OpenAPIHono } from '@hono/zod-openapi';
import { reportSlaContract } from '@arcbase/shared/report';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  createReportSlaRule,
  deleteReportSlaRule,
  getReportSlaRule,
  listReportSlaRules,
  listReportSlaViolations,
  submitReportSlaEvaluation,
  updateReportSlaRule,
  updateReportSlaViolation,
} from '../../services/report/report-sla.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRulesRoute = defineContractRoute(reportSlaContract.rules, {
  handler: async (c) => c.json(okBody(await listReportSlaRules(c.req.valid('query'))), 200),
});

const getRuleRoute = defineContractRoute(reportSlaContract.ruleDetail, {
  handler: async (c) => c.json(okBody(await getReportSlaRule(c.req.valid('param').id)), 200),
});

const createRuleRoute = defineContractRoute(reportSlaContract.createRule, {
  handler: async (c) => c.json(okBody(await createReportSlaRule(c.req.valid('json')), '创建成功'), 200),
});

const updateRuleRoute = defineContractRoute(reportSlaContract.updateRule, {
  handler: async (c) => c.json(okBody(await updateReportSlaRule(c.req.valid('param').id, c.req.valid('json')), '更新成功'), 200),
});

const deleteRuleRoute = defineContractRoute(reportSlaContract.removeRule, {
  handler: async (c) => {
    await deleteReportSlaRule(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const evaluateRoute = defineContractRoute(reportSlaContract.evaluate, {
  handler: async (c) => c.json(okBody(await submitReportSlaEvaluation(c.req.valid('param').id), '任务已提交'), 200),
});

const violationsRoute = defineContractRoute(reportSlaContract.violations, {
  handler: async (c) => c.json(okBody(await listReportSlaViolations(c.req.valid('query'))), 200),
});

const violationStatusRoute = defineContractRoute(reportSlaContract.updateViolationStatus, {
  handler: async (c) => c.json(okBody(await updateReportSlaViolation(c.req.valid('param').id, c.req.valid('json')), '操作成功'), 200),
});

router.openapiRoutes([
  listRulesRoute, getRuleRoute, createRuleRoute, updateRuleRoute, deleteRuleRoute,
  evaluateRoute, violationsRoute, violationStatusRoute,
] as const);

export default router;
