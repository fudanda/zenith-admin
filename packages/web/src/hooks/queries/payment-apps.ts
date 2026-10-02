import type { QueryOf } from '@arcbase/shared/core';
import { paymentAppContract } from '@arcbase/shared/payment';
import { createResourceQueries } from '@/lib/contract-query';

export type PaymentAppListParams = NonNullable<QueryOf<typeof paymentAppContract.list>>;

export const {
  keys: paymentAppKeys,
  useList: usePaymentAppList,
  useDetail: usePaymentAppDetail,
  useSave: useSavePaymentApp,
  /** 契约无批量删除操作，多选删除按单条并发执行 */
  useDelete: useDeletePaymentApp,
} = createResourceQueries(paymentAppContract);
