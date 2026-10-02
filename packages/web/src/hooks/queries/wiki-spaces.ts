import type { QueryOf } from '@arcbase/shared/core';
import { wikiSpaceContract } from '@arcbase/shared/wiki';
import { contractKey, createResourceQueries, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { LOOKUP_STALE_TIME } from '@/lib/query';

export type WikiSpaceListParams = NonNullable<QueryOf<typeof wikiSpaceContract.list>>;

/** 「我可访问的空间」独立于管理列表，空间增删改后需一并失效 */
export const myWikiSpacesKey = contractKey(wikiSpaceContract.my);

export const {
  keys: wikiSpaceKeys,
  useList: useWikiSpaceList,
  useDetail: useWikiSpaceDetail,
  useSave: useSaveWikiSpace,
  useDelete: useDeleteWikiSpaces,
} = createResourceQueries(wikiSpaceContract, {
  onSaved: (qc) => void qc.invalidateQueries({ queryKey: myWikiSpacesKey }),
  onDeleted: (qc) => void qc.invalidateQueries({ queryKey: myWikiSpacesKey }),
});

/** 文档中心侧栏空间下拉（低频，全局共享） */
export function useMyWikiSpaces() {
  return useApiQuery(wikiSpaceContract.my, { staleTime: LOOKUP_STALE_TIME });
}

// ─── 空间成员（独立生命周期的子资源，挂在 listMembers 操作名下）──────────────

export const wikiSpaceMemberKeys = {
  of: (spaceId: number) => contractKey(wikiSpaceContract.listMembers, { params: { id: spaceId } }),
};

export function useWikiSpaceMembers(spaceId: number | undefined, enabled = true) {
  return useApiQuery(wikiSpaceContract.listMembers, { params: { id: spaceId ?? 0 } }, { enabled: enabled && spaceId !== undefined });
}

/** 保存成员后：成员子键 + 空间列表（memberCount 派生列）都要刷新；成员角色变化影响「我可访问的空间」里的 myRole */
export function useSaveWikiSpaceMembers() {
  return useApiMutation(wikiSpaceContract.saveMembers, {
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: wikiSpaceMemberKeys.of(params.id) });
      void qc.invalidateQueries({ queryKey: wikiSpaceKeys.lists });
      void qc.invalidateQueries({ queryKey: myWikiSpacesKey });
    },
  });
}
