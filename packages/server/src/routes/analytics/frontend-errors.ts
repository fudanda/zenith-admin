import { OpenAPIHono, z } from '@hono/zod-openapi';
import { ANALYTICS_SITE_KEY_HEADER, frontendErrorContract } from '@arcbase/shared/analytics';
import { optionalAuthMiddleware } from '../../middleware/optional-auth';
import { namedRateLimit } from '../../middleware/rate-limit';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { getClientIp } from '../../lib/request-helpers';
import {
  reportError, getErrorOverview, listGroups, getGroupDetail, updateGroup, batchUpdateGroupStatus,
  deleteGroups, listErrorEvents, cleanErrors, uploadSourceMap, listSourceMaps, deleteSourceMap,
} from '../../services/analytics/frontend-errors.service';
import { listAlertRules, createAlertRule, updateAlertRule, deleteAlertRule, listAlertLogs, testAlertRule } from '../../services/analytics/error-alert.service';

const r = new OpenAPIHono({ defaultHook: validationHook });

// ─── 上报 ─────────────────────────────────────────────────────────────────────
// 浏览器错误风暴时该入口会被突发打满：在 server 使用点对契约请求体做 AOT 预编译换事件循环余量
// （不在 shared 定义点编译，避免把 zod 编译器带进 web 包；strict 保证 schema 不可编译时启动即报错）
const reportOp = { ...frontendErrorContract.report, body: z.compile(frontendErrorContract.report.body, { strict: true }) };

const reportRoute = defineContractRoute(reportOp, {
  middleware: [optionalAuthMiddleware, namedRateLimit('error-report')],
  handler: async (c) => {
    await reportError(c.req.valid('json'), {
      ip: getClientIp(c),
      ua: c.req.header('user-agent') ?? '',
      siteKey: c.req.header(ANALYTICS_SITE_KEY_HEADER) ?? null,
      origin: c.req.header('origin') ?? null,
    });
    return c.json(okBody(null, '上报成功'), 200);
  },
});

// ─── 概览 ─────────────────────────────────────────────────────────────────────
const overviewRoute = defineContractRoute(frontendErrorContract.overview, {
  handler: async (c) => c.json(okBody(await getErrorOverview(c.req.valid('query').days)), 200),
});

// ─── 分组（Issue）列表 / 详情 / 处理 ──────────────────────────────────────────
const groupListRoute = defineContractRoute(frontendErrorContract.groups, {
  handler: async (c) => c.json(okBody(await listGroups(c.req.valid('query'))), 200),
});

const batchStatusRoute = defineContractRoute(frontendErrorContract.batchUpdateGroupStatus, {
  handler: async (c) => {
    const n = await batchUpdateGroupStatus(c.req.valid('json').ids, c.req.valid('query').status);
    return c.json(okBody(null, `已更新 ${n} 条`), 200);
  },
});

const batchDeleteRoute = defineContractRoute(frontendErrorContract.batchDeleteGroups, {
  handler: async (c) => {
    const n = await deleteGroups(c.req.valid('json').ids);
    return c.json(okBody(null, `已删除 ${n} 条`), 200);
  },
});

const groupDetailRoute = defineContractRoute(frontendErrorContract.groupDetail, {
  handler: async (c) => c.json(okBody(await getGroupDetail(c.req.valid('param').id)), 200),
});

const groupUpdateRoute = defineContractRoute(frontendErrorContract.updateGroup, {
  handler: async (c) => c.json(okBody(await updateGroup(c.req.valid('param').id, c.req.valid('json')), '更新成功'), 200),
});

// ─── 错误事件 ─────────────────────────────────────────────────────────────────
const eventListRoute = defineContractRoute(frontendErrorContract.events, {
  handler: async (c) => c.json(okBody(await listErrorEvents(c.req.valid('query'))), 200),
});

const cleanRoute = defineContractRoute(frontendErrorContract.clean, {
  handler: async (c) => {
    const n = await cleanErrors(c.req.valid('query').days);
    return c.json(okBody(null, `共清除 ${n} 条记录`), 200);
  },
});

// ─── Source Map ──────────────────────────────────────────────────────────────
const sourceMapListRoute = defineContractRoute(frontendErrorContract.sourceMaps, {
  handler: async (c) => c.json(okBody(await listSourceMaps(c.req.valid('query'))), 200),
});

const sourceMapUploadRoute = defineContractRoute(frontendErrorContract.uploadSourceMap, {
  handler: async (c) => c.json(okBody(await uploadSourceMap(c.req.valid('json')), '上传成功'), 200),
});

const sourceMapDeleteRoute = defineContractRoute(frontendErrorContract.removeSourceMap, {
  handler: async (c) => {
    await deleteSourceMap(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

// ─── 告警规则 ─────────────────────────────────────────────────────────────────
const alertListRoute = defineContractRoute(frontendErrorContract.alerts, {
  handler: async (c) => c.json(okBody(await listAlertRules(c.req.valid('query'))), 200),
});

const alertCreateRoute = defineContractRoute(frontendErrorContract.createAlert, {
  handler: async (c) => c.json(okBody(await createAlertRule(c.req.valid('json')), '创建成功'), 200),
});

const alertUpdateRoute = defineContractRoute(frontendErrorContract.updateAlert, {
  handler: async (c) => c.json(okBody(await updateAlertRule(c.req.valid('param').id, c.req.valid('json')), '更新成功'), 200),
});

const alertDeleteRoute = defineContractRoute(frontendErrorContract.removeAlert, {
  handler: async (c) => {
    await deleteAlertRule(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const alertLogListRoute = defineContractRoute(frontendErrorContract.alertLogs, {
  handler: async (c) => c.json(okBody(await listAlertLogs(c.req.valid('query'))), 200),
});

const alertTestRoute = defineContractRoute(frontendErrorContract.testAlert, {
  handler: async (c) => {
    await testAlertRule(c.req.valid('param').id);
    return c.json(okBody(null, '测试消息已发送，请检查各通知渠道'), 200);
  },
});

r.openapiRoutes([
  reportRoute, overviewRoute,
  groupListRoute, batchStatusRoute, batchDeleteRoute, groupDetailRoute, groupUpdateRoute,
  eventListRoute, cleanRoute,
  sourceMapListRoute, sourceMapUploadRoute, sourceMapDeleteRoute,
  alertListRoute, alertCreateRoute, alertUpdateRoute, alertDeleteRoute, alertLogListRoute, alertTestRoute,
] as const);

export default r;
