import { resourceKeyOf, type QueryOf } from '@arcbase/shared/core';
import { channelAnalysisContract, shortLinkContract } from '@arcbase/shared/short-link';
import { contractKey, createResourceQueries, useApiMutation, useApiQuery } from '@/lib/contract-query';

export const {
  keys: shortLinkKeys,
  useList: useShortLinkList,
  useDetail: useShortLinkDetail,
  useSave: useSaveShortLink,
  useDelete: useDeleteShortLinks,
} = createResourceQueries(shortLinkContract);

/** 批量启用/禁用：影响列表与被操作详情，精确失效两者 */
export function useBatchUpdateShortLinkStatus() {
  return useApiMutation(shortLinkContract.batchUpdateStatus, {
    invalidate: (qc, _output, { body }) => {
      void qc.invalidateQueries({ queryKey: shortLinkKeys.lists });
      for (const id of body.ids) void qc.invalidateQueries({ queryKey: shortLinkKeys.detail(id) });
    },
  });
}

/** 业务对象幂等取短链（payment-link/CMS 等页面嵌入）：可能新建记录，失效列表 */
export function useEnsureShortLink() {
  return useApiMutation(shortLinkContract.ensure, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: shortLinkKeys.lists });
    },
  });
}

/** 访问统计是昂贵派生查询：key 落在 stats 操作名下，不被列表 / 详情的失效连坐 */
export const shortLinkStatsKeys = {
  all: [resourceKeyOf(shortLinkContract.basePath), shortLinkContract.stats.name] as const,
  stats: (id: number, days: number) => contractKey(shortLinkContract.stats, { params: { id }, query: { days } }),
};

export function useShortLinkStats(id: number | null, days: number) {
  return useApiQuery(shortLinkContract.stats, { params: { id: id ?? 0 }, query: { days } }, { enabled: id !== null });
}

export type ChannelAnalysisParams = QueryOf<typeof channelAnalysisContract.analyze>;

/** 渠道推广分析：独立资源的纯读聚合，不与短链列表互相失效 */
export function useChannelAnalysis(params: ChannelAnalysisParams) {
  return useApiQuery(channelAnalysisContract.analyze, { query: params });
}
