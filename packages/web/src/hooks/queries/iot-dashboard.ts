import { iotDashboardContract } from '@arcbase/shared/iot';
import { contractKey, useApiQuery } from '@/lib/contract-query';

export const iotDashboardKeys = {
  all: contractKey(iotDashboardContract.overview),
};

export function useIotDashboard() {
  // 总览页驻留期间自动刷新（在线率/告警为运行态数据）
  return useApiQuery(iotDashboardContract.overview, { refetchInterval: 30_000 });
}
