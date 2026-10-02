import { keepPreviousData } from '@tanstack/react-query';
import type { QueryOf } from '@arcbase/shared/core';
import { iotScheduleContract } from '@arcbase/shared/iot';
import { contractKey, createResourceQueries, useApiQuery } from '@/lib/contract-query';

// ─── 计划任务 ─────────────────────────────────────────────────────────────────
export type IotScheduleListParams = NonNullable<QueryOf<typeof iotScheduleContract.list>>;

export const {
  keys: iotScheduleKeys,
  useList: useIotScheduleList,
  useSave: useSaveIotSchedule,
  useDelete: useDeleteIotSchedules,
} = createResourceQueries(iotScheduleContract);

// ─── 执行记录（只读追加型）────────────────────────────────────────────────────
export type IotScheduleRunListParams = NonNullable<QueryOf<typeof iotScheduleContract.runs>>;

export const iotScheduleRunKeys = {
  list: (params: IotScheduleRunListParams) => contractKey(iotScheduleContract.runs, { query: params }),
};

export function useIotScheduleRunList(params: IotScheduleRunListParams, enabled = true) {
  return useApiQuery(iotScheduleContract.runs, { query: params }, { placeholderData: keepPreviousData, enabled });
}
