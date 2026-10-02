import { keepPreviousData, type QueryClient } from '@tanstack/react-query';
import { resourceKeyOf, type QueryOf } from '@arcbase/shared/core';
import { exceptionLogContract } from '@arcbase/shared/platform';
import { contractKey, useApiMutation, useApiQuery, useSaveMutation } from '@/lib/contract-query';

export type ExceptionGroupParams = NonNullable<QueryOf<typeof exceptionLogContract.groups>>;
export type ExceptionEventParams = NonNullable<QueryOf<typeof exceptionLogContract.events>>;
export type ExceptionAlertParams = NonNullable<QueryOf<typeof exceptionLogContract.alerts>>;
export type ExceptionAlertLogParams = NonNullable<QueryOf<typeof exceptionLogContract.alertLogs>>;

export const exceptionLogKeys = {
  all: [resourceKeyOf(exceptionLogContract.basePath)] as const,
  overview: contractKey(exceptionLogContract.overview),
  groupsLists: contractKey(exceptionLogContract.groups),
  groupDetail: (id: number | undefined) => contractKey(exceptionLogContract.groupDetail, { params: { id: id ?? 0 } }),
  eventsLists: contractKey(exceptionLogContract.events),
  alertsLists: contractKey(exceptionLogContract.alerts),
  alertLogsLists: contractKey(exceptionLogContract.alertLogs),
};

export function useExceptionOverview(days: number, enabled = true) {
  return useApiQuery(exceptionLogContract.overview, { query: { days } }, { enabled });
}

/** 采集器进程内计数：轮询看板式刷新 */
export function useExceptionReporterStatus(enabled = true) {
  return useApiQuery(exceptionLogContract.reporterStatus, undefined, { enabled, refetchInterval: 15_000 });
}

export function useExceptionGroups(params: ExceptionGroupParams, enabled = true) {
  return useApiQuery(exceptionLogContract.groups, { query: params }, { placeholderData: keepPreviousData, enabled });
}

export function useExceptionGroupDetail(id: number | undefined, enabled = true) {
  return useApiQuery(exceptionLogContract.groupDetail, { params: { id: id ?? 0 } }, { enabled: enabled && id !== undefined });
}

export function useExceptionEvents(params: ExceptionEventParams, enabled = true) {
  return useApiQuery(exceptionLogContract.events, { query: params }, { placeholderData: keepPreviousData, enabled });
}

export function useExceptionEventDetail(id: number | undefined, enabled = true) {
  return useApiQuery(exceptionLogContract.eventDetail, { params: { id: id ?? 0 } }, { enabled: enabled && id !== undefined });
}

/** 分组状态 / 指派 / 删除会改变列表、概览与详情三处派生视图；事件行不受影响 */
function invalidateGroups(qc: QueryClient, id?: number) {
  void qc.invalidateQueries({ queryKey: exceptionLogKeys.groupsLists });
  void qc.invalidateQueries({ queryKey: exceptionLogKeys.overview });
  if (id !== undefined) void qc.invalidateQueries({ queryKey: exceptionLogKeys.groupDetail(id) });
}

export function useUpdateExceptionGroup() {
  return useApiMutation(exceptionLogContract.updateGroup, {
    invalidate: (qc, _output, variables) => invalidateGroups(qc, variables.params.id),
  });
}

export function useBatchUpdateExceptionGroups() {
  return useApiMutation(exceptionLogContract.batchUpdateGroupStatus, {
    invalidate: (qc, _output, variables) => {
      invalidateGroups(qc);
      for (const id of variables.body.ids) void qc.invalidateQueries({ queryKey: exceptionLogKeys.groupDetail(id) });
    },
  });
}

export function useBatchDeleteExceptionGroups() {
  return useApiMutation(exceptionLogContract.batchDeleteGroups, {
    invalidate: (qc, _output, variables) => {
      invalidateGroups(qc);
      // 分组级联删除事件：事件列表也要刷新，已删分组的详情缓存直接移除
      void qc.invalidateQueries({ queryKey: exceptionLogKeys.eventsLists });
      for (const id of variables.body.ids) qc.removeQueries({ queryKey: exceptionLogKeys.groupDetail(id) });
    },
  });
}

export function useExceptionAlerts(params: ExceptionAlertParams, enabled = true) {
  return useApiQuery(exceptionLogContract.alerts, { query: params }, { placeholderData: keepPreviousData, enabled });
}

const invalidateAlerts = (qc: QueryClient) => void qc.invalidateQueries({ queryKey: exceptionLogKeys.alertsLists });

export function useSaveExceptionAlert() {
  return useSaveMutation(exceptionLogContract.createAlert, exceptionLogContract.updateAlert, { invalidate: invalidateAlerts });
}

export function useDeleteExceptionAlert() {
  return useApiMutation(exceptionLogContract.removeAlert, { invalidate: invalidateAlerts });
}

/** 试发只写触发历史，规则本身不变 */
export function useTestExceptionAlert() {
  return useApiMutation(exceptionLogContract.testAlert, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: exceptionLogKeys.alertLogsLists }),
  });
}

export function useExceptionAlertLogs(params: ExceptionAlertLogParams, enabled = true) {
  return useApiQuery(exceptionLogContract.alertLogs, { query: params }, { placeholderData: keepPreviousData, enabled });
}
