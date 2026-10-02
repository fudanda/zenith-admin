import { emailTemplateContract } from '@arcbase/shared/messaging';
import { createResourceQueries } from '@/lib/contract-query';

export const {
  keys: emailTemplateKeys,
  useList: useEmailTemplateList,
  useDetail: useEmailTemplateDetail,
  useSave: useSaveEmailTemplate,
  useDelete: useDeleteEmailTemplate,
} = createResourceQueries(emailTemplateContract);