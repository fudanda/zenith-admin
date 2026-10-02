import { keepPreviousData } from '@tanstack/react-query';
import type { QueryOf } from '@arcbase/shared/core';
import { impersonationContract } from '@arcbase/shared/identity';
import { contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';

export type ImpersonationListParams = NonNullable<QueryOf<typeof impersonationContract.list>>;

export const impersonationKeys = {
  lists: contractKey(impersonationContract.list),
  list: (params: ImpersonationListParams) => contractKey(impersonationContract.list, { query: params }),
};

export function useImpersonationList(params: ImpersonationListParams) {
  return useApiQuery(impersonationContract.list, { query: params }, { placeholderData: keepPreviousData });
}

/** 开始模拟：成功后整页重载为目标身份，无需失效任何查询 */
export function useStartImpersonation() {
  return useApiMutation(impersonationContract.start);
}

/** 强制结束：记录列表是本域唯一查询 */
export function useForceEndImpersonation() {
  return useApiMutation(impersonationContract.forceEnd, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: impersonationKeys.lists }),
  });
}
