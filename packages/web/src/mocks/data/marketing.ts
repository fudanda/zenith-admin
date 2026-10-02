import { SEED_MARKETING_CAMPAIGNS, SEED_MARKETING_PRIZES } from '@arcbase/shared/seed';
import type { MarketingCampaign, MarketingParticipation, MarketingPrize } from '@arcbase/shared/marketing';
import { mockDateTime } from '@/mocks/utils/date';
import { nextIdFrom } from '@/mocks/utils/handlers';

export const mockMarketingCampaigns: MarketingCampaign[] = SEED_MARKETING_CAMPAIGNS.map((c) => ({
  ...c,
  participationCount: 128,
  awardCount: 45,
  shortUrl: `${window.location.origin}/s/lot2026`,
}));

export const mockMarketingPrizes: MarketingPrize[] = SEED_MARKETING_PRIZES.map((p) => ({ ...p }));

export const mockMarketingParticipations: MarketingParticipation[] = Array.from({ length: 23 }, (_, i) => {
  const won = i % 3 === 0;
  const prize = mockMarketingPrizes[i % mockMarketingPrizes.length];
  const isWonPrize = won && prize.prizeType !== 'none';
  return {
    id: i + 1,
    campaignId: 1,
    memberId: 100 + i,
    memberNickname: `演示会员${100 + i}`,
    prizeId: isWonPrize ? prize.id : null,
    prizeName: isWonPrize ? prize.name : null,
    grantStatus: isWonPrize ? (i % 9 === 0 ? 'failed' : 'granted') : 'none',
    grantNote: isWonPrize ? (i % 9 === 0 ? '积分账户异常，发放失败' : prize.prizeType === 'physical' ? '实物奖品，线下发放' : '已自动发放') : null,
    createdAt: mockDateTime(),
  };
});

let nextCampaignId = nextIdFrom(mockMarketingCampaigns);
export function getNextMarketingCampaignId(): number {
  return nextCampaignId++;
}

let nextPrizeId = nextIdFrom(mockMarketingPrizes);
export function getNextMarketingPrizeId(): number {
  return nextPrizeId++;
}
