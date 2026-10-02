import type {
  SqlMonitorHistoryPoint,
  SqlMonitorLock,
  SqlMonitorOverview,
  SqlMonitorQuery,
  SqlMonitorSession,
} from '@arcbase/shared/platform';
import { mockDateTimeOffset } from '@/mocks/utils/date';

export const sqlMonitorQueries: SqlMonitorQuery[] = [
  {
    databaseName: 'arcbase_admin', queryId: '1849327610',
    query: 'SELECT id, username, nickname FROM users WHERE status = $1 ORDER BY created_at DESC LIMIT $2',
    calls: 18_420, totalMs: 12_840, meanMs: 0.697, rows: 184_200,
    sharedBlksHit: 1_842_120, sharedBlksRead: 8_240, tempBlksRead: 0, tempBlksWritten: 0, cacheHitRatio: 99.56,
  },
  {
    databaseName: 'arcbase_admin', queryId: '2667418294',
    query: 'SELECT * FROM operation_logs WHERE created_at >= $1 AND created_at < $2 ORDER BY created_at DESC',
    calls: 2_184, totalMs: 9_680, meanMs: 4.433, rows: 87_360,
    sharedBlksHit: 492_120, sharedBlksRead: 34_920, tempBlksRead: 4_120, tempBlksWritten: 2_060, cacheHitRatio: 93.38,
  },
  {
    databaseName: 'arcbase_admin', queryId: '3948172201',
    query: 'UPDATE async_tasks SET status = $1, completed_at = $2 WHERE id = $3',
    calls: 1_208, totalMs: 4_220, meanMs: 3.493, rows: 1_208,
    sharedBlksHit: 18_340, sharedBlksRead: 2_120, tempBlksRead: 0, tempBlksWritten: 0, cacheHitRatio: 89.66,
  },
  {
    databaseName: 'arcbase_admin', queryId: '5172041187',
    query: 'SELECT tenant_id, count(*) FROM user_events WHERE created_at >= $1 GROUP BY tenant_id',
    calls: 320, totalMs: 3_870, meanMs: 12.094, rows: 64,
    sharedBlksHit: 32_400, sharedBlksRead: 8_820, tempBlksRead: 9_120, tempBlksWritten: 6_480, cacheHitRatio: 78.60,
  },
  {
    databaseName: 'arcbase_admin', queryId: '7009182440',
    query: null,
    calls: 86, totalMs: 1_120, meanMs: 13.023, rows: 86,
    sharedBlksHit: 2_100, sharedBlksRead: 300, tempBlksRead: 0, tempBlksWritten: 0, cacheHitRatio: null,
  },
];

export const sqlMonitorSessions: SqlMonitorSession[] = [
  {
    pid: 24811, username: 'admin', applicationName: 'arcbase-web', clientAddress: '10.0.0.12', database: 'arcbase_admin',
    state: 'active', waitEventType: null, waitEvent: null, backendType: 'client backend',
    query: 'SELECT id, username, nickname FROM users WHERE status = $1 ORDER BY created_at DESC LIMIT $2',
    querySeconds: 0.42, transactionSeconds: 0.8, backendSeconds: 3_220, queryStart: mockDateTimeOffset(-420_000), backendStart: mockDateTimeOffset(-3_220_000), backendStartToken: '24811-20260915T230500Z', blockedBy: [], isCurrent: false,
  },
  {
    pid: 24827, username: 'worker', applicationName: 'arcbase-worker', clientAddress: '10.0.0.20', database: 'arcbase_admin',
    state: 'active', waitEventType: 'Lock', waitEvent: 'transactionid', backendType: 'client backend',
    query: 'UPDATE async_tasks SET status = $1, completed_at = $2 WHERE id = $3',
    querySeconds: 18.4, transactionSeconds: 20.1, backendSeconds: 4_120, queryStart: mockDateTimeOffset(-18_400), backendStart: mockDateTimeOffset(-4_120_000), backendStartToken: '24827-20260915T225400Z', blockedBy: [24832], isCurrent: false,
  },
  {
    pid: 24832, username: 'report', applicationName: 'arcbase-report', clientAddress: '10.0.0.31', database: 'arcbase_admin',
    state: 'idle in transaction', waitEventType: null, waitEvent: null, backendType: 'client backend',
    query: 'SELECT tenant_id, count(*) FROM user_events WHERE created_at >= $1 GROUP BY tenant_id',
    querySeconds: null, transactionSeconds: 46.8, backendSeconds: 8_912, queryStart: null, backendStart: mockDateTimeOffset(-8_912_000), backendStartToken: '24832-20260915T204900Z', blockedBy: [], isCurrent: false,
  },
  {
    pid: 24840, username: 'admin', applicationName: 'arcbase-web', clientAddress: '127.0.0.1', database: 'arcbase_admin',
    state: 'active', waitEventType: null, waitEvent: null, backendType: 'client backend',
    query: 'SELECT 1', querySeconds: 0.003, transactionSeconds: 0, backendSeconds: 1_024, queryStart: mockDateTimeOffset(-3), backendStart: mockDateTimeOffset(-1_024_000), backendStartToken: '24840-20260915T225950Z', blockedBy: [], isCurrent: true,
  },
];

export const sqlMonitorLocks: SqlMonitorLock[] = [
  { pid: 24827, blockedBy: [24832], relation: 'public.async_tasks', lockType: 'tuple', mode: 'ExclusiveLock', granted: false, waitSeconds: 18.4, query: 'UPDATE async_tasks SET status = $1, completed_at = $2 WHERE id = $3' },
  { pid: 24832, blockedBy: [], relation: 'public.user_events', lockType: 'relation', mode: 'RowExclusiveLock', granted: true, waitSeconds: null, query: 'SELECT tenant_id, count(*) FROM user_events WHERE created_at >= $1 GROUP BY tenant_id' },
  { pid: 24811, blockedBy: [], relation: 'public.users', lockType: 'relation', mode: 'AccessShareLock', granted: true, waitSeconds: null, query: 'SELECT id, username, nickname FROM users WHERE status = $1 ORDER BY created_at DESC LIMIT $2' },
];

export const sqlMonitorHistory: SqlMonitorHistoryPoint[] = Array.from({ length: 24 }, (_, index) => {
  const sampledAt = mockDateTimeOffset(-(23 - index) * 15 * 60_000);
  const wave = Math.sin(index / 3);
  const calls = Math.round(1_600 + wave * 240 + index * 18);
  const totalMs = Math.round(2_400 + wave * 420 + index * 24);
  return {
    sampledAt,
    queryCount: 42 + (index % 5),
    calls,
    totalMs,
    meanMs: +(totalMs / calls).toFixed(3),
  };
});

export function getSqlMonitorOverview(): SqlMonitorOverview {
  const calls = sqlMonitorQueries.reduce((sum, item) => sum + item.calls, 0);
  const totalMs = sqlMonitorQueries.reduce((sum, item) => sum + item.totalMs, 0);
  return {
    stats: { available: true, reason: null },
    databaseName: 'arcbase_admin',
    sampledAt: mockDateTimeOffset(0),
    queryCount: sqlMonitorQueries.length,
    calls,
    totalMs,
    meanMs: calls > 0 ? totalMs / calls : null,
    activeSessions: sqlMonitorSessions.filter((item) => item.state === 'active').length,
    waitingSessions: sqlMonitorSessions.filter((item) => item.waitEventType != null).length,
    blockedSessions: sqlMonitorSessions.filter((item) => item.blockedBy.length > 0).length,
    deadlocks: 0,
    cacheHitRatio: 98.42,
    sampleIntervalMinutes: 1,
    sampleRetentionDays: 30,
    topQueries: sqlMonitorQueries.slice(0, 5),
  };
}
