import { OpenAPIHono, z } from '@hono/zod-openapi';
import { ANALYTICS_SITE_KEY_HEADER, analyticsContract } from '@arcbase/shared/analytics';
import { optionalAuthMiddleware } from '../../middleware/optional-auth';
import { namedRateLimit } from '../../middleware/rate-limit';
import { defineContractRoute } from '../../lib/contract-route';
import { requireRow } from '../../lib/db-assert';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { getClientIp } from '../../lib/request-helpers';
import { parseDateRangeStart, parseDateRangeEnd, formatDate } from '../../lib/datetime';
import {
  batchInsertEvents, getOverview, getTrends, getPageStats, getFeatureStats, getHeatmapData,
  getHeatmapPageList, getUserStats, listSessions, getPathAnalysis,
  getUserTimeline, getPerfStats, getRealtime, listAnalyticsEvents,
  getEventDetail, cleanAnalyticsEvents, getSessionTimeline,
} from '../../services/analytics/analytics.service';
import { getFunnel, getRetention } from '../../services/analytics/analytics-conversion.service';
import { getAcquisitionReport } from '../../services/analytics/analytics-acquisition.service';
import { drillUsers } from '../../services/analytics/analytics-drill.service';
import { queryEvents } from '../../services/analytics/analytics-event-query.service';
import {
  listSegments, getSegmentDetail, ensureSegmentExists, createSegment, updateSegment, deleteSegment, listSegmentMembers,
} from '../../services/analytics/analytics-segments.service';
import { getPublicConfig } from '../../services/analytics/analytics-settings.service';
import { listEventMeta, createEventMeta, updateEventMeta, deleteEventMeta, getEventMetaReferences } from '../../services/analytics/analytics-event-meta.service';
import { getRollupSummary } from '../../services/analytics/analytics-rollup.service';
import { listSavedReports, createSavedReport, deleteSavedReport } from '../../services/analytics/analytics-reports.service';
import {
  listEventOverrides, createEventOverride, updateEventOverride, deleteEventOverride,
} from '../../services/analytics/analytics-event-overrides.service';
import { queryQuality, listDebugEvents } from '../../services/analytics/analytics-quality.service';
import { mapAsyncTask, submitAsyncTask } from '../../lib/task-center';
import { getCreateTenantId } from '../../lib/tenant';
import { currentUser } from '../../lib/context';
import { ANALYTICS_ROLLUP_REBUILD_TASK_TYPE, ANALYTICS_SEGMENT_MATERIALIZE_TASK_TYPE } from '../../services/analytics/analytics-tasks';

const r = new OpenAPIHono({ defaultHook: validationHook });

// ─── 采集 ─────────────────────────────────────────────────────────────────────
// 采集入口是全站最高频公开解析点：在 server 使用点对契约请求体做 AOT 预编译换事件循环余量
// （不在 shared 定义点编译，避免把 zod 编译器带进 web 包；strict 保证 schema 不可编译时启动即报错）
const trackOp = { ...analyticsContract.track, body: z.compile(analyticsContract.track.body, { strict: true }) };

const ingestRoute = defineContractRoute(trackOp, {
  middleware: [optionalAuthMiddleware, namedRateLimit('analytics-ingest')],
  handler: async (c) => {
    const { events } = c.req.valid('json');
    await batchInsertEvents(events, {
      ip: getClientIp(c),
      ua: c.req.header('user-agent') ?? '',
      siteKey: c.req.header(ANALYTICS_SITE_KEY_HEADER) ?? c.req.valid('query').siteKey ?? null,
      origin: c.req.header('origin') ?? null,
    });
    return c.json(okBody(null, '上报成功'), 200);
  },
});

const configRoute = defineContractRoute(analyticsContract.config, {
  middleware: [optionalAuthMiddleware],
  handler: async (c) => c.json(okBody(await getPublicConfig(c.req.header(ANALYTICS_SITE_KEY_HEADER) ?? c.req.valid('query').siteKey ?? null)), 200),
});

// ─── 概览 / 趋势 / 实时 ───────────────────────────────────────────────────────
const overviewRoute = defineContractRoute(analyticsContract.overview, {
  handler: async (c) => c.json(okBody(await getOverview(c.req.valid('query'))), 200),
});

const trendsRoute = defineContractRoute(analyticsContract.trends, {
  handler: async (c) => c.json(okBody(await getTrends(c.req.valid('query'))), 200),
});

const realtimeRoute = defineContractRoute(analyticsContract.realtime, {
  handler: async (c) => c.json(okBody(await getRealtime()), 200),
});

// ─── 页面/功能/热力图/用户 ────────────────────────────────────────────────────
const pageStatsRoute = defineContractRoute(analyticsContract.pageStats, {
  handler: async (c) => c.json(okBody(await getPageStats(c.req.valid('query'))), 200),
});

const featureStatsRoute = defineContractRoute(analyticsContract.featureStats, {
  handler: async (c) => c.json(okBody(await getFeatureStats(c.req.valid('query'))), 200),
});

const heatmapRoute = defineContractRoute(analyticsContract.heatmap, {
  handler: async (c) => c.json(okBody(await getHeatmapData(c.req.valid('query'))), 200),
});

const heatmapPagesRoute = defineContractRoute(analyticsContract.heatmapPages, {
  handler: async (c) => c.json(okBody(await getHeatmapPageList(c.req.valid('query'))), 200),
});

const userStatsRoute = defineContractRoute(analyticsContract.userStats, {
  handler: async (c) => c.json(okBody(await getUserStats(c.req.valid('query'))), 200),
});

// ─── 会话 / 漏斗 / 留存 / 获客 / 下钻 / 事件分析 / 路径 / 时间线 / 性能 ────────
const sessionsRoute = defineContractRoute(analyticsContract.sessions, {
  handler: async (c) => c.json(okBody(await listSessions(c.req.valid('query'))), 200),
});

const funnelRoute = defineContractRoute(analyticsContract.funnel, {
  handler: async (c) => c.json(okBody(await getFunnel(c.req.valid('json'))), 200),
});

const retentionRoute = defineContractRoute(analyticsContract.retention, {
  handler: async (c) => c.json(okBody(await getRetention(c.req.valid('json'))), 200),
});

const acquisitionRoute = defineContractRoute(analyticsContract.acquisition, {
  handler: async (c) => c.json(okBody(await getAcquisitionReport(c.req.valid('query'))), 200),
});

const drillUsersRoute = defineContractRoute(analyticsContract.drillUsers, {
  handler: async (c) => c.json(okBody(await drillUsers(c.req.valid('json'))), 200),
});

const eventQueryRoute = defineContractRoute(analyticsContract.queryEvents, {
  handler: async (c) => c.json(okBody(await queryEvents(c.req.valid('json'))), 200),
});

const pathRoute = defineContractRoute(analyticsContract.path, {
  handler: async (c) => c.json(okBody(await getPathAnalysis(c.req.valid('query'))), 200),
});

const userTimelineRoute = defineContractRoute(analyticsContract.userTimeline, {
  handler: async (c) => c.json(okBody(await getUserTimeline(c.req.valid('query'))), 200),
});

const sessionTimelineRoute = defineContractRoute(analyticsContract.sessionTimeline, {
  handler: async (c) => {
    const q = c.req.valid('query');
    return c.json(okBody(await getSessionTimeline(q.sessionId, q.limit)), 200);
  },
});

const perfRoute = defineContractRoute(analyticsContract.perfStats, {
  handler: async (c) => c.json(okBody(await getPerfStats(c.req.valid('query').days)), 200),
});

// ─── 保存的分析报表 ───────────────────────────────────────────────────────────
const reportListRoute = defineContractRoute(analyticsContract.reports, {
  handler: async (c) => c.json(okBody({ list: await listSavedReports(c.req.valid('query').type) }), 200),
});

const reportCreateRoute = defineContractRoute(analyticsContract.createReport, {
  handler: async (c) => c.json(okBody(await createSavedReport(c.req.valid('json')), '保存成功'), 200),
});

const reportDeleteRoute = defineContractRoute(analyticsContract.removeReport, {
  handler: async (c) => {
    await deleteSavedReport(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

// ─── 事件数据管理 ─────────────────────────────────────────────────────────────
const eventListRoute = defineContractRoute(analyticsContract.events, {
  handler: async (c) => {
    const q = c.req.valid('query');
    return c.json(okBody(await listAnalyticsEvents({
      ...q,
      startTime: parseDateRangeStart(q.startTime) ?? undefined,
      endTime: parseDateRangeEnd(q.endTime) ?? undefined,
    })), 200);
  },
});

const eventDetailRoute = defineContractRoute(analyticsContract.eventDetail, {
  handler: async (c) => {
    const detail = requireRow(await getEventDetail(c.req.valid('param').id), '事件不存在');
    return c.json(okBody(detail), 200);
  },
});

const cleanRoute = defineContractRoute(analyticsContract.clean, {
  handler: async (c) => {
    const deleted = await cleanAnalyticsEvents(c.req.valid('query').days);
    return c.json(okBody(null, `共删除 ${deleted} 条事件数据`), 200);
  },
});

// ─── 事件元数据 ───────────────────────────────────────────────────────────────
const metaListRoute = defineContractRoute(analyticsContract.eventMeta, {
  handler: async (c) => c.json(okBody(await listEventMeta(c.req.valid('query'))), 200),
});

const metaCreateRoute = defineContractRoute(analyticsContract.createEventMeta, {
  handler: async (c) => c.json(okBody(await createEventMeta(c.req.valid('json')), '创建成功'), 200),
});

const metaUpdateRoute = defineContractRoute(analyticsContract.updateEventMeta, {
  handler: async (c) => c.json(okBody(await updateEventMeta(c.req.valid('param').id, c.req.valid('json')), '更新成功'), 200),
});

const metaDeleteRoute = defineContractRoute(analyticsContract.removeEventMeta, {
  handler: async (c) => {
    await deleteEventMeta(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const metaReferencesRoute = defineContractRoute(analyticsContract.eventMetaReferences, {
  handler: async (c) => c.json(okBody(await getEventMetaReferences(c.req.valid('query').eventName)), 200),
});

// ─── 租户级事件启停覆盖 ───────────────────────────────────────────────────────
const overrideListRoute = defineContractRoute(analyticsContract.eventOverrides, {
  handler: async (c) => c.json(okBody(await listEventOverrides(c.req.valid('query'))), 200),
});

const overrideCreateRoute = defineContractRoute(analyticsContract.createEventOverride, {
  handler: async (c) => c.json(okBody(await createEventOverride(c.req.valid('json')), '创建成功'), 200),
});

const overrideUpdateRoute = defineContractRoute(analyticsContract.updateEventOverride, {
  handler: async (c) => c.json(okBody(await updateEventOverride(c.req.valid('param').id, c.req.valid('json')), '更新成功'), 200),
});

const overrideDeleteRoute = defineContractRoute(analyticsContract.removeEventOverride, {
  handler: async (c) => {
    await deleteEventOverride(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

// ─── 埋点质量看板 / 事件调试流 ────────────────────────────────────────────────
const qualityRoute = defineContractRoute(analyticsContract.quality, {
  handler: async (c) => c.json(okBody(await queryQuality(c.req.valid('query'))), 200),
});

const debugEventsRoute = defineContractRoute(analyticsContract.debugEvents, {
  handler: async (c) => c.json(okBody(await listDebugEvents(c.req.valid('query'))), 200),
});

// ─── 数据聚合 ─────────────────────────────────────────────────────────────────
const rollupGetRoute = defineContractRoute(analyticsContract.rollup, {
  handler: async (c) => c.json(okBody({ items: await getRollupSummary(c.req.valid('query').days) }), 200),
});

const rollupRebuildRoute = defineContractRoute(analyticsContract.rebuildRollup, {
  handler: async (c) => {
    const { days } = c.req.valid('query');
    const user = currentUser();
    const tenantId = getCreateTenantId(user);
    const idempotencyKey = `${ANALYTICS_ROLLUP_REBUILD_TASK_TYPE}:${tenantId ?? 0}:${user.userId}:${days}:${formatDate(new Date())}`;
    const row = await submitAsyncTask({
      taskType: ANALYTICS_ROLLUP_REBUILD_TASK_TYPE,
      title: `重建近 ${days} 天聚合`,
      payload: { days },
      idempotencyKey,
    });
    return c.json(okBody(mapAsyncTask(row), '任务已提交，可在任务中心查看进度'), 200);
  },
});

// ─── 用户分群 CRUD + 成员物化 ─────────────────────────────────────────────────
const segmentListRoute = defineContractRoute(analyticsContract.segments, {
  handler: async (c) => c.json(okBody(await listSegments(c.req.valid('query'))), 200),
});

const segmentCreateRoute = defineContractRoute(analyticsContract.createSegment, {
  handler: async (c) => c.json(okBody(await createSegment(c.req.valid('json')), '创建成功'), 200),
});

const segmentDetailRoute = defineContractRoute(analyticsContract.segmentDetail, {
  handler: async (c) => c.json(okBody(await getSegmentDetail(c.req.valid('param').id)), 200),
});

const segmentUpdateRoute = defineContractRoute(analyticsContract.updateSegment, {
  handler: async (c) => c.json(okBody(await updateSegment(c.req.valid('param').id, c.req.valid('json')), '更新成功'), 200),
});

const segmentDeleteRoute = defineContractRoute(analyticsContract.removeSegment, {
  handler: async (c) => {
    await deleteSegment(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const segmentMembersRoute = defineContractRoute(analyticsContract.segmentMembers, {
  handler: async (c) => c.json(okBody(await listSegmentMembers(c.req.valid('param').id, c.req.valid('query'))), 200),
});

const segmentMaterializeRoute = defineContractRoute(analyticsContract.materializeSegment, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const segment = await ensureSegmentExists(id); // 校验 tenant，并用规则版本打破旧任务幂等键
    const minuteBucket = Math.floor(Date.now() / 60_000);
    const idempotencyKey = `${ANALYTICS_SEGMENT_MATERIALIZE_TASK_TYPE}:${id}:${segment.updatedAt.getTime()}:${minuteBucket}`;
    const row = await submitAsyncTask({
      taskType: ANALYTICS_SEGMENT_MATERIALIZE_TASK_TYPE,
      title: `重算分群 #${id} 成员`,
      payload: { segmentId: id },
      idempotencyKey,
    });
    return c.json(okBody(mapAsyncTask(row), '任务已提交，可在任务中心查看进度'), 200);
  },
});

// 注册顺序即匹配顺序；同一路由器的多次 openapiRoutes() 按主题分批，避免单个元组过深导致类型实例化超限
r.openapiRoutes([
  ingestRoute, configRoute,
  overviewRoute, trendsRoute, realtimeRoute,
  pageStatsRoute, featureStatsRoute, heatmapRoute, heatmapPagesRoute, userStatsRoute,
  sessionsRoute, funnelRoute, retentionRoute, acquisitionRoute, drillUsersRoute, eventQueryRoute, pathRoute, userTimelineRoute, sessionTimelineRoute, perfRoute,
] as const);

r.openapiRoutes([
  reportListRoute, reportCreateRoute, reportDeleteRoute,
  eventListRoute, eventDetailRoute, cleanRoute,
  metaListRoute, metaCreateRoute, metaUpdateRoute, metaDeleteRoute, metaReferencesRoute,
  overrideListRoute, overrideCreateRoute, overrideUpdateRoute, overrideDeleteRoute,
] as const);

r.openapiRoutes([
  qualityRoute, debugEventsRoute,
  rollupGetRoute, rollupRebuildRoute,
  segmentListRoute, segmentCreateRoute, segmentDetailRoute, segmentUpdateRoute, segmentDeleteRoute,
  segmentMembersRoute, segmentMaterializeRoute,
] as const);

export default r;
