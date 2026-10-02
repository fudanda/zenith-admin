import { dashboardContract as legacyDashboardContract, goDashboardContract } from '@arcbase/shared/analytics';
import { IS_GO_FOUNDATION } from '@/lib/foundation-mode';
import { contractKey, useApiQuery } from '@/lib/contract-query';

/**
 * 工作台自有数据。
 *
 * 公告不在此列：顶栏公告铃铛与工作台公告卡片读的是同一份已发布公告，
 * 统一复用 `announcements.ts` 的域 hook，避免两份缓存导致已读状态不同步。
 */
const dashboardContract = { ...legacyDashboardContract, ...(IS_GO_FOUNDATION ? { stats: goDashboardContract.stats } : {}) };
export const dashboardKeys = {
  stats: contractKey(dashboardContract.stats),
  charts: contractKey(dashboardContract.charts),
};

export function useDashboardStats(enabled = true) {
  return useApiQuery(dashboardContract.stats, { enabled, requestOptions: { silent: true } });
}

export function useDashboardCharts(enabled = true) {
  return useApiQuery(dashboardContract.charts, { enabled, requestOptions: { silent: true } });
}
