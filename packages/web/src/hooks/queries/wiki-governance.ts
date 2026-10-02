import { keepPreviousData, type QueryClient } from '@tanstack/react-query';
import { wikiGovernanceContract, type WikiGovernanceKind } from '@arcbase/shared/wiki';
import { useApiMutation, useApiQuery } from '@/lib/contract-query';
import { wikiDocKeys, wikiDocTreeKeys } from './wiki-docs';
import { wikiGovernanceKeys, wikiStatsKeys, type WikiGovernanceDocListParams } from './wiki-query-keys';

export { wikiGovernanceKeys, type WikiGovernanceDocListParams } from './wiki-query-keys';

export function useWikiGovernanceDocs(kind: WikiGovernanceKind, params: WikiGovernanceDocListParams, enabled = true) {
  return useApiQuery(wikiGovernanceContract.listDocs, { query: { ...params, kind } }, { placeholderData: keepPreviousData, enabled });
}

export function useWikiNoResultKeywords(enabled = true) {
  return useApiQuery(wikiGovernanceContract.noResultKeywords, { enabled });
}

/** 治理批量操作共用失效：各清单相互流动（归档会离开原清单进入已归档等） */
function invalidateGovernance(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: wikiGovernanceKeys.lists });
}

/** 提醒是纯通知副作用，不改变任何列表数据，无需失效 */
export function useRemindGovernanceOwners() {
  return useApiMutation(wikiGovernanceContract.remind);
}

/** 归档影响治理清单、文档列表与目录树（归档后从树 / 列表隐藏） */
export function useArchiveGovernanceDocs() {
  return useApiMutation(wikiGovernanceContract.archive, {
    invalidate: (qc) => {
      invalidateGovernance(qc);
      void qc.invalidateQueries({ queryKey: wikiDocKeys.lists });
      void qc.invalidateQueries({ queryKey: wikiDocTreeKeys.all });
      void qc.invalidateQueries({ queryKey: wikiStatsKeys.ops });
    },
  });
}

export function useSetGovernanceOwner() {
  return useApiMutation(wikiGovernanceContract.setOwner, {
    invalidate: (qc) => {
      invalidateGovernance(qc);
      void qc.invalidateQueries({ queryKey: wikiStatsKeys.ops });
    },
  });
}

export function useSetGovernanceReview() {
  return useApiMutation(wikiGovernanceContract.setReviewCycle, {
    invalidate: (qc) => {
      invalidateGovernance(qc);
      void qc.invalidateQueries({ queryKey: wikiStatsKeys.ops });
    },
  });
}

/** 导入生成新草稿：文档列表与对应空间目录树刷新 */
export function useImportWikiDocs() {
  return useApiMutation(wikiGovernanceContract.importDocs, {
    invalidate: (qc, _output, { body }) => {
      void qc.invalidateQueries({ queryKey: wikiDocKeys.lists });
      void qc.invalidateQueries({ queryKey: wikiDocTreeKeys.of(body.spaceId) });
      void qc.invalidateQueries({ queryKey: wikiStatsKeys.overview });
      void qc.invalidateQueries({ queryKey: wikiStatsKeys.contributors });
      void qc.invalidateQueries({ queryKey: wikiStatsKeys.ops });
    },
  });
}
