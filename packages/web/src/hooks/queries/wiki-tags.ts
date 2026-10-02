import type { QueryOf } from '@arcbase/shared/core';
import { wikiTagContract } from '@arcbase/shared/wiki';
import { createResourceQueries } from '@/lib/contract-query';

export type WikiTagListParams = NonNullable<QueryOf<typeof wikiTagContract.list>>;

/** 标签没有详情端点：契约未声明 detail，工厂不提供 useDetail */
export const {
  keys: wikiTagKeys,
  useList: useWikiTagList,
  useSave: useSaveWikiTag,
  useDelete: useDeleteWikiTags,
  useLookup: useAllWikiTags,
} = createResourceQueries(wikiTagContract);
