import { inAppTemplateContract } from '@arcbase/shared/messaging';
import { createResourceQueries } from '@/lib/contract-query';

export const {
  keys: inAppTemplateKeys,
  useList: useInAppTemplateList,
  useDetail: useInAppTemplateDetail,
  useSave: useSaveInAppTemplate,
  useDelete: useDeleteInAppTemplate,
} = createResourceQueries(inAppTemplateContract);