import { resourceKeyOf } from '@arcbase/shared/core';
import { traceContract, type TraceNodeKind } from '@arcbase/shared/platform';
import { contractKey, useApiQuery } from '@/lib/contract-query';

export const traceKeys = {
  all: [resourceKeyOf(traceContract.basePath)] as const,
  of: (traceId: string) => contractKey(traceContract.timeline, { params: { traceId } }),
  recent: (days: number) => contractKey(traceContract.recent, { query: { days } }),
  failures: (params: { days: number; kind: TraceNodeKind | undefined }) => contractKey(traceContract.recentFailures, { query: params }),
};

/** 最近链路（无 ID 浏览入口） */
export function useRecentTraces(days: number) {
  return useApiQuery(traceContract.recent, { query: { days } });
}

/** 链路时间线（纯读；traceId 为空时不请求） */
export function useTraceTimeline(traceId: string | null) {
  return useApiQuery(traceContract.timeline, { params: { traceId: traceId ?? '' } }, { enabled: Boolean(traceId) });
}

/** 最近失败链路（排障入口） */
export function useRecentTraceFailures(days: number, kind: TraceNodeKind | undefined, enabled = true) {
  return useApiQuery(traceContract.recentFailures, { query: { days, kind } }, { enabled });
}
