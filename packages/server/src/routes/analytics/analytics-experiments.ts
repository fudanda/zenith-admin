import { OpenAPIHono } from '@hono/zod-openapi';
import { ANALYTICS_SITE_KEY_HEADER, analyticsExperimentContract } from '@arcbase/shared/analytics';
import { optionalAuthMiddleware } from '../../middleware/optional-auth';
import { namedRateLimit } from '../../middleware/rate-limit';
import { currentMemberOrNull } from '../../lib/member-context';
import { currentUserOrNull } from '../../lib/context';
import { getCreateTenantId } from '../../lib/tenant';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { resolveSiteByKey } from '../../services/analytics/analytics-sites.service';
import {
  completeExperiment,
  createExperiment,
  deleteExperiment,
  getAssignments,
  getExperiment,
  getExperimentReport,
  listExperiments,
  pauseExperiment,
  startExperiment,
  updateExperiment,
} from '../../services/analytics/analytics-experiments.service';

const r = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineContractRoute(analyticsExperimentContract.experiments, {
  handler: async (c) => c.json(okBody(await listExperiments(c.req.valid('query'))), 200),
});

const detailRoute = defineContractRoute(analyticsExperimentContract.experimentDetail, {
  handler: async (c) => c.json(okBody(await getExperiment(c.req.valid('param').id)), 200),
});

const createExperimentRoute = defineContractRoute(analyticsExperimentContract.createExperiment, {
  handler: async (c) => c.json(okBody(await createExperiment(c.req.valid('json')), '创建成功'), 200),
});

const updateExperimentRoute = defineContractRoute(analyticsExperimentContract.updateExperiment, {
  handler: async (c) => c.json(okBody(await updateExperiment(c.req.valid('param').id, c.req.valid('json')), '更新成功'), 200),
});

const deleteExperimentRoute = defineContractRoute(analyticsExperimentContract.removeExperiment, {
  handler: async (c) => {
    await deleteExperiment(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const startRoute = defineContractRoute(analyticsExperimentContract.startExperiment, {
  handler: async (c) => c.json(okBody(await startExperiment(c.req.valid('param').id), '操作成功'), 200),
});

const pauseRoute = defineContractRoute(analyticsExperimentContract.pauseExperiment, {
  handler: async (c) => c.json(okBody(await pauseExperiment(c.req.valid('param').id), '操作成功'), 200),
});

const completeRoute = defineContractRoute(analyticsExperimentContract.completeExperiment, {
  handler: async (c) => c.json(okBody(await completeExperiment(c.req.valid('param').id), '操作成功'), 200),
});

const reportRoute = defineContractRoute(analyticsExperimentContract.experimentReport, {
  handler: async (c) => c.json(okBody(await getExperimentReport(c.req.valid('param').id, c.req.valid('query'))), 200),
});

const assignmentsRoute = defineContractRoute(analyticsExperimentContract.assignments, {
  middleware: [optionalAuthMiddleware, namedRateLimit('analytics-ingest')],
  handler: async (c) => {
    const user = currentUserOrNull();
    const member = user ? undefined : currentMemberOrNull();
    const { siteKey, keys: rawKeys, distinctId: queryDistinctId } = c.req.valid('query');
    const site = (!user && !member) ? await resolveSiteByKey(c.req.header(ANALYTICS_SITE_KEY_HEADER) ?? siteKey ?? null).catch(() => null) : null;
    // 匿名 distinctId 禁止伪造登录态前缀（与 ingest resolveDistinctId 反伪造规则一致）
    const anonDistinctId = queryDistinctId && !queryDistinctId.startsWith('u:') && !queryDistinctId.startsWith('m:') ? queryDistinctId : undefined;
    const distinctId = user ? `u:${user.userId}` : member ? `m:${member.memberId}` : anonDistinctId;
    if (!distinctId) return c.json(okBody([]), 200);
    const tenantId = user ? getCreateTenantId(user) : member ? (member.tenantId ?? null) : (site?.tenantId ?? null);
    const keys = rawKeys?.split(',').map((key) => key.trim()).filter(Boolean).slice(0, 20);
    return c.json(okBody(await getAssignments(distinctId, tenantId, keys)), 200);
  },
});

r.openapiRoutes([
  assignmentsRoute,
  listRoute,
  detailRoute,
  createExperimentRoute,
  updateExperimentRoute,
  deleteExperimentRoute,
  startRoute,
  pauseRoute,
  completeRoute,
  reportRoute,
] as const);

export default r;
