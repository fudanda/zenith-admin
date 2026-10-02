import type { QueryClient } from '@tanstack/react-query';
import { resourceKeyOf, type QueryOf } from '@arcbase/shared/core';
import { marketingCampaignContract, type MarketingCampaign } from '@arcbase/shared/marketing';
import { contractKey, createResourceQueries, useApiMutation, useApiQuery } from '@/lib/contract-query';

export const {
  keys: marketingCampaignKeys,
  useList: useMarketingCampaignList,
  useDetail: useMarketingCampaignDetail,
  useSave: useSaveMarketingCampaign,
  useDelete: useDeleteMarketingCampaigns,
} = createResourceQueries(marketingCampaignContract);

/** 发布/结束：状态与统计都变化，失效列表与详情 */
function invalidateCampaign(qc: QueryClient, saved: MarketingCampaign) {
  void qc.invalidateQueries({ queryKey: marketingCampaignKeys.detail(saved.id) });
  void qc.invalidateQueries({ queryKey: marketingCampaignKeys.lists });
}

export function usePublishMarketingCampaign() {
  return useApiMutation(marketingCampaignContract.publish, { invalidate: invalidateCampaign });
}

export function useEndMarketingCampaign() {
  return useApiMutation(marketingCampaignContract.end, { invalidate: invalidateCampaign });
}

/** 奖品是独立生命周期的子资源：key 落在 listPrizes 操作名下，不被活动列表失效连坐 */
export const marketingPrizeKeys = {
  all: [resourceKeyOf(marketingCampaignContract.basePath), marketingCampaignContract.listPrizes.name] as const,
  of: (campaignId: number) => contractKey(marketingCampaignContract.listPrizes, { params: { campaignId } }),
};

export function useMarketingPrizes(campaignId: number | null) {
  return useApiQuery(marketingCampaignContract.listPrizes, { params: { campaignId: campaignId ?? 0 } }, { enabled: campaignId !== null });
}

/** 奖品写操作只影响该活动的奖品列表（活动列表不展示奖品数） */
function invalidatePrizes(qc: QueryClient, campaignId: number) {
  void qc.invalidateQueries({ queryKey: marketingPrizeKeys.of(campaignId) });
}

export function useCreateMarketingPrize() {
  return useApiMutation(marketingCampaignContract.createPrize, {
    invalidate: (qc, _saved, { params }) => invalidatePrizes(qc, params.campaignId),
  });
}

export function useUpdateMarketingPrize() {
  return useApiMutation(marketingCampaignContract.updatePrize, {
    invalidate: (qc, _saved, { params }) => invalidatePrizes(qc, params.campaignId),
  });
}

export function useDeleteMarketingPrize() {
  return useApiMutation(marketingCampaignContract.removePrize, {
    invalidate: (qc, _data, { params }) => invalidatePrizes(qc, params.campaignId),
  });
}

export type MarketingParticipationParams = QueryOf<typeof marketingCampaignContract.listParticipations>;

/** 参与记录：纯读分页，key 落在 listParticipations 操作名下 */
export function useMarketingParticipations(campaignId: number | null, params: MarketingParticipationParams) {
  return useApiQuery(
    marketingCampaignContract.listParticipations,
    { params: { campaignId: campaignId ?? 0 }, query: params },
    { enabled: campaignId !== null },
  );
}
