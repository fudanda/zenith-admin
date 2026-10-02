import { keepPreviousData, type QueryClient } from '@tanstack/react-query';
import { cmsDashboardContract, cmsStatContract, cmsTelemetryAdminContract } from '@arcbase/shared/cms';
import type { QueryOf } from '@arcbase/shared/core';
import { contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { cmsSiteKeys } from './cms-sites';
import { invalidateCmsPublishingViews } from './cms-stage3';

export type CmsStatsQuery = QueryOf<typeof cmsStatContract.overview>;
export type CmsStatsReportQuery = QueryOf<typeof cmsStatContract.report>;

export const cmsStatKeys = {
  overview: contractKey(cmsStatContract.overview),
  report: contractKey(cmsStatContract.report),
  quality: contractKey(cmsStatContract.quality),
  options: contractKey(cmsStatContract.options),
  visits: (siteId: number | undefined, days: number) => contractKey(cmsStatContract.visits, { query: { siteId: siteId ?? 0, days } }),
  search: (siteId: number | undefined, days: number) => contractKey(cmsStatContract.search, { query: { siteId: siteId ?? 0, days } }),
};

export function useCmsStatsOverview(query: CmsStatsQuery) {
  return useApiQuery(cmsStatContract.overview, { query }, { enabled: query.siteId > 0, refetchInterval: 60_000 });
}
export function useCmsStatsReport(query: CmsStatsReportQuery, enabled = true) {
  return useApiQuery(cmsStatContract.report, { query }, { enabled: query.siteId > 0 && enabled, placeholderData: keepPreviousData });
}
export function useCmsStatsQuality(query: CmsStatsQuery) {
  return useApiQuery(cmsStatContract.quality, { query }, { enabled: query.siteId > 0, refetchInterval: 60_000 });
}
export function useCmsStatsOptions(query: CmsStatsQuery) {
  return useApiQuery(cmsStatContract.options, { query }, { enabled: query.siteId > 0 });
}
export function invalidateCmsCollectionStatus(qc: QueryClient, siteId?: number) {
  for (const operation of [cmsStatContract.quality, cmsStatContract.overview]) {
    void qc.invalidateQueries({ queryKey: siteId ? contractKey(operation, { query: { siteId } }) : contractKey(operation) });
  }
}
export function useConfigureCmsTelemetry() {
  return useApiMutation(cmsTelemetryAdminContract.configure, {
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: cmsSiteKeys.detail(params.id) });
      void qc.invalidateQueries({ queryKey: cmsSiteKeys.lists });
      void qc.invalidateQueries({ queryKey: cmsSiteKeys.lookup });
      cmsSiteKeys.hierarchy.forEach((queryKey) => void qc.invalidateQueries({ queryKey }));
      invalidateCmsCollectionStatus(qc, params.id);
      invalidateCmsPublishingViews(qc);
    },
  });
}

export const cmsDashboardKeys = {
  /** 全部站点看板统计的公共前缀（内容 / 栏目 / 评论写操作后按此失效） */
  statsAll: contractKey(cmsDashboardContract.stats),
  stats: (siteId: number | undefined) => contractKey(cmsDashboardContract.stats, { query: { siteId: siteId ?? 0 } }),
};

/**
 * 看板统计由内容表、栏目表与评论表聚合而来（totals / todayPublished / publishTrend /
 * channelDistribution / pendingComments）：内容状态与归属、栏目名称、评论审核任一变化都会改变它。
 * 访问统计来自统一行为事实，普通内容编辑不改变已接收事件，不在此失效。
 */
export function invalidateCmsDashboardStats(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: cmsDashboardKeys.statsAll });
}

export function useCmsVisitStats(siteId: number | undefined, days: number) {
  return useApiQuery(cmsStatContract.visits, { query: { siteId: siteId ?? 0, days } }, {
    enabled: siteId !== undefined,
    refetchInterval: 60_000,
  });
}

export function useCmsSearchAnalytics(siteId: number | undefined, days: number) {
  return useApiQuery(cmsStatContract.search, { query: { siteId: siteId ?? 0, days } }, {
    enabled: siteId !== undefined,
  });
}

export function useCmsDashboardStats(siteId: number | undefined) {
  return useApiQuery(cmsDashboardContract.stats, { query: { siteId: siteId ?? 0 } }, {
    enabled: siteId !== undefined,
    refetchInterval: 60_000,
  });
}
