import { keepPreviousData } from '@tanstack/react-query';
import type { QueryOf } from '@arcbase/shared/core';
import { iotAutomationContract } from '@arcbase/shared/iot';
import { contractKey, createResourceQueries, useApiQuery } from '@/lib/contract-query';

// ─── 联动规则 ─────────────────────────────────────────────────────────────────
export type IotAutomationListParams = NonNullable<QueryOf<typeof iotAutomationContract.list>>;

export const {
  keys: iotAutomationKeys,
  useList: useIotAutomationList,
  useSave: useSaveIotAutomation,
  useDelete: useDeleteIotAutomations,
} = createResourceQueries(iotAutomationContract);

// ─── 执行记录（只读追加型，无变更入口）───────────────────────────────────────
export type IotAutomationRunListParams = NonNullable<QueryOf<typeof iotAutomationContract.runs>>;

export const iotAutomationRunKeys = {
  list: (params: IotAutomationRunListParams) => contractKey(iotAutomationContract.runs, { query: params }),
};

export function useIotAutomationRunList(params: IotAutomationRunListParams, enabled = true) {
  return useApiQuery(iotAutomationContract.runs, { query: params }, { placeholderData: keepPreviousData, enabled });
}
