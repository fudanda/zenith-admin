import { keepPreviousData, type QueryClient } from '@tanstack/react-query';
import type { QueryOf } from '@arcbase/shared/core';
import { sqlMonitorContract } from '@arcbase/shared/platform';
import { contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';

export type SqlMonitorQueriesParams = NonNullable<QueryOf<typeof sqlMonitorContract.queries>>;
export type SqlMonitorHistoryParams = NonNullable<QueryOf<typeof sqlMonitorContract.history>>;

export const sqlMonitorKeys = {
  overview: contractKey(sqlMonitorContract.overview),
  queries: contractKey(sqlMonitorContract.queries),
  queriesOf: (query: SqlMonitorQueriesParams) => contractKey(sqlMonitorContract.queries, { query }),
  sessions: contractKey(sqlMonitorContract.sessions),
  locks: contractKey(sqlMonitorContract.locks),
  history: contractKey(sqlMonitorContract.history),
  historyOf: (query: SqlMonitorHistoryParams) => contractKey(sqlMonitorContract.history, { query }),
};

export const SQL_MONITOR_REFETCH_INTERVAL_MS = 15_000;

function invalidateLiveMonitorQueries(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: sqlMonitorKeys.overview });
  void qc.invalidateQueries({ queryKey: sqlMonitorKeys.sessions });
  void qc.invalidateQueries({ queryKey: sqlMonitorKeys.locks });
}

export function useSqlMonitorOverview(refetchInterval: number | false = SQL_MONITOR_REFETCH_INTERVAL_MS) {
  return useApiQuery(sqlMonitorContract.overview, {
    placeholderData: keepPreviousData,
    refetchInterval,
    refetchIntervalInBackground: false,
  });
}

export function useSqlMonitorQueries(
  query: SqlMonitorQueriesParams,
  options: { enabled?: boolean; refetchInterval?: number | false } = {},
) {
  return useApiQuery(sqlMonitorContract.queries, { query }, {
    enabled: options.enabled ?? true,
    placeholderData: keepPreviousData,
    refetchInterval: options.refetchInterval ?? SQL_MONITOR_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
}

export function useSqlMonitorSessions(
  options: { enabled?: boolean; refetchInterval?: number | false } = {},
) {
  return useApiQuery(sqlMonitorContract.sessions, undefined, {
    enabled: options.enabled ?? true,
    placeholderData: keepPreviousData,
    refetchInterval: options.refetchInterval ?? SQL_MONITOR_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
}

export function useSqlMonitorLocks(
  options: { enabled?: boolean; refetchInterval?: number | false } = {},
) {
  return useApiQuery(sqlMonitorContract.locks, undefined, {
    enabled: options.enabled ?? true,
    placeholderData: keepPreviousData,
    refetchInterval: options.refetchInterval ?? SQL_MONITOR_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
}

export function useSqlMonitorHistory(
  query: SqlMonitorHistoryParams,
  options: { enabled?: boolean; refetchInterval?: number | false } = {},
) {
  return useApiQuery(sqlMonitorContract.history, { query }, {
    enabled: options.enabled ?? true,
    placeholderData: keepPreviousData,
    refetchInterval: options.refetchInterval ?? 60_000,
    refetchIntervalInBackground: false,
  });
}

export function useSqlMonitorSessionAction() {
  return useApiMutation(sqlMonitorContract.sessionAction, {
    invalidate: (qc) => invalidateLiveMonitorQueries(qc),
  });
}

export function useResetSqlMonitorStats() {
  return useApiMutation(sqlMonitorContract.reset, {
    invalidate: (qc) => {
      invalidateLiveMonitorQueries(qc);
      void qc.invalidateQueries({ queryKey: sqlMonitorKeys.queries });
      void qc.invalidateQueries({ queryKey: sqlMonitorKeys.history });
    },
  });
}
