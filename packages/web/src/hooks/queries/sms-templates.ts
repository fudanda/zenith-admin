import { smsTemplateContract } from '@arcbase/shared/messaging';
import { createResourceQueries } from '@/lib/contract-query';

export const {
  keys: smsTemplateKeys,
  useList: useSmsTemplateList,
  useDetail: useSmsTemplateDetail,
  useSave: useSaveSmsTemplate,
  useDelete: useDeleteSmsTemplate,
} = createResourceQueries(smsTemplateContract);