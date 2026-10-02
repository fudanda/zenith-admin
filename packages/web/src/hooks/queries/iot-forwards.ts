import { keepPreviousData } from '@tanstack/react-query';
import type { QueryOf } from '@arcbase/shared/core';
import { iotForwardRuleContract } from '@arcbase/shared/iot';
import { contractKey, createResourceQueries, useApiQuery } from '@/lib/contract-query';

// ─── 流转规则 ─────────────────────────────────────────────────────────────────
export type IotForwardRuleListParams = NonNullable<QueryOf<typeof iotForwardRuleContract.list>>;

export const {
  keys: iotForwardRuleKeys,
  useList: useIotForwardRuleList,
  useSave: useSaveIotForwardRule,
  useDelete: useDeleteIotForwardRules,
} = createResourceQueries(iotForwardRuleContract);

// ─── 投递日志（只读追加型）────────────────────────────────────────────────────
export type IotForwardLogListParams = NonNullable<QueryOf<typeof iotForwardRuleContract.logs>>;

export const iotForwardLogKeys = {
  list: (params: IotForwardLogListParams) => contractKey(iotForwardRuleContract.logs, { query: params }),
};

export function useIotForwardLogList(params: IotForwardLogListParams, enabled = true) {
  return useApiQuery(iotForwardRuleContract.logs, { query: params }, { placeholderData: keepPreviousData, enabled });
}
