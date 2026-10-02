import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import {
  ApiRecorder,
  createRequestMock,
  createTestQueryClient,
  createWrapper,
  observeFetches,
} from '@/test-utils/query-harness';

const api = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => api) }));

import {
  sqlMonitorKeys,
  useResetSqlMonitorStats,
  useSqlMonitorHistory,
  useSqlMonitorLocks,
  useSqlMonitorOverview,
  useSqlMonitorQueries,
  useSqlMonitorSessions,
  useSqlMonitorSessionAction,
} from './sql-monitor';

const OVERVIEW = {
  stats: { available: true, reason: null },
  databaseName: 'arcbase_admin',
  sampledAt: '2026-09-15 23:00:00',
  queryCount: 1,
  calls: 10,
  totalMs: 20,
  meanMs: 2,
  activeSessions: 1,
  waitingSessions: 0,
  blockedSessions: 0,
  deadlocks: 0,
  cacheHitRatio: 99,
  sampleIntervalMinutes: 1,
  sampleRetentionDays: 30,
  topQueries: [],
};

beforeEach(() => {
  api.reset();
  api
    .on('GET', '/api/sql-monitor', OVERVIEW)
    .on('GET', '/api/sql-monitor/queries', { stats: { available: true, reason: null }, list: [] })
    .on('GET', '/api/sql-monitor/sessions', { list: [] })
    .on('GET', '/api/sql-monitor/locks', { list: [] })
    .on('GET', '/api/sql-monitor/history', { stats: { available: true, reason: null }, points: [] })
    .on('POST', '/api/sql-monitor/sessions/action', { ok: true, message: '已取消' })
    .on('POST', '/api/sql-monitor/reset', { ok: true, message: '已重置' });
});

describe('sql monitor cache invalidation', () => {
  it('refreshes live sessions and locks after a session action without refetching history', async () => {
    const qc = createTestQueryClient();
    const hook = renderHook(() => ({
      overview: useSqlMonitorOverview(false),
      queries: useSqlMonitorQueries({ sort: 'totalMs', limit: 50 }, { refetchInterval: false }),
      sessions: useSqlMonitorSessions({ refetchInterval: false }),
      locks: useSqlMonitorLocks({ refetchInterval: false }),
      history: useSqlMonitorHistory({ range: '1h' }, { refetchInterval: false }),
      action: useSqlMonitorSessionAction(),
    }), { wrapper: createWrapper(qc) });

    await waitFor(() => {
      expect(hook.result.current.overview.isSuccess).toBe(true);
      expect(hook.result.current.history.isSuccess).toBe(true);
    });

    const fetches = observeFetches(qc);
    api.resetCalls();
    await hook.result.current.action.mutateAsync({ body: { pid: 100, backendStartToken: 'token', action: 'cancel' } });
    await waitFor(() => expect(hook.result.current.sessions.isFetching).toBe(false));

    expect(fetches.countOf(sqlMonitorKeys.overview)).toBe(1);
    expect(fetches.countOf(sqlMonitorKeys.sessions)).toBe(1);
    expect(fetches.countOf(sqlMonitorKeys.locks)).toBe(1);
    expect(fetches.countOf(sqlMonitorKeys.queries)).toBe(0);
    expect(fetches.countOf(sqlMonitorKeys.history)).toBe(0);
    fetches.stop();
  });

  it('refreshes every monitoring surface after resetting accumulated statistics', async () => {
    const qc = createTestQueryClient();
    const hook = renderHook(() => ({
      overview: useSqlMonitorOverview(false),
      queries: useSqlMonitorQueries({ sort: 'totalMs', limit: 50 }, { refetchInterval: false }),
      sessions: useSqlMonitorSessions({ refetchInterval: false }),
      locks: useSqlMonitorLocks({ refetchInterval: false }),
      history: useSqlMonitorHistory({ range: '1h' }, { refetchInterval: false }),
      reset: useResetSqlMonitorStats(),
    }), { wrapper: createWrapper(qc) });

    await waitFor(() => expect(hook.result.current.overview.isSuccess).toBe(true));
    const fetches = observeFetches(qc);
    api.resetCalls();
    await hook.result.current.reset.mutateAsync({});
    await waitFor(() => expect(hook.result.current.history.isFetching).toBe(false));

    expect(fetches.countOf(sqlMonitorKeys.overview)).toBe(1);
    expect(fetches.countOf(sqlMonitorKeys.queries)).toBe(1);
    expect(fetches.countOf(sqlMonitorKeys.sessions)).toBe(1);
    expect(fetches.countOf(sqlMonitorKeys.locks)).toBe(1);
    expect(fetches.countOf(sqlMonitorKeys.history)).toBe(1);
    fetches.stop();
  });
});
