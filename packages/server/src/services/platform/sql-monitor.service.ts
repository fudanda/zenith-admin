import { sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { QueryOutputOf } from '@arcbase/shared/core';
import type { SqlMonitorHistoryPoint, SqlMonitorLock, SqlMonitorOverview, SqlMonitorQuery, SqlMonitorSession } from '@arcbase/shared/platform';
import { SQL_MONITOR_SESSION_ACTIONS, type SqlMonitorQuerySort, sqlMonitorContract } from '@arcbase/shared/platform';
import { db } from '../../db';
import { sqlQuerySamples } from '../../db/schema';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { getPolicyRetentionDays } from '../../lib/retention';
import { getSettings } from '../../lib/settings';
import { scrubSqlText } from '../../lib/sql-monitor';
import { keywordCondition } from '../../lib/where-helpers';
import { cancelBackend, terminateBackend } from '../ops/db-admin-ops.service';

type SqlQueryListQuery = QueryOutputOf<typeof sqlMonitorContract.queries>;
type SqlHistoryQuery = QueryOutputOf<typeof sqlMonitorContract.history>;

type RawQueryRow = {
  database_name: string;
  query_id: string;
  query: string | null;
  calls: number | string;
  total_ms: number | string;
  mean_ms: number | string;
  rows: number | string;
  shared_blks_hit: number | string;
  shared_blks_read: number | string;
  temp_blks_read: number | string;
  temp_blks_written: number | string;
};

type QueryStatsResult = {
  available: boolean;
  reason: string | null;
  list: SqlMonitorQuery[];
};

function unavailable(reason = '当前数据库未启用 pg_stat_statements'): QueryStatsResult {
  return { available: false, reason, list: [] };
}

function sortSql(sort: SqlMonitorQuerySort | undefined) {
  switch (sort) {
    case 'meanMs': return sql`mean_exec_time`;
    case 'calls': return sql`calls`;
    case 'rows': return sql`rows`;
    case 'sharedBlksRead': return sql`shared_blks_read`;
    case 'tempBlksRead': return sql`temp_blks_read`;
    case 'totalMs':
    default: return sql`total_exec_time`;
  }
}

function mapQuery(row: RawQueryRow, maxChars: number): SqlMonitorQuery {
  const sharedBlksHit = Number(row.shared_blks_hit ?? 0);
  const sharedBlksRead = Number(row.shared_blks_read ?? 0);
  const totalBlocks = sharedBlksHit + sharedBlksRead;
  return {
    databaseName: String(row.database_name),
    queryId: String(row.query_id),
    query: scrubSqlText(row.query, maxChars),
    calls: Number(row.calls ?? 0),
    totalMs: Number(row.total_ms ?? 0),
    meanMs: Number(row.mean_ms ?? 0),
    rows: Number(row.rows ?? 0),
    sharedBlksHit,
    sharedBlksRead,
    tempBlksRead: Number(row.temp_blks_read ?? 0),
    tempBlksWritten: Number(row.temp_blks_written ?? 0),
    cacheHitRatio: totalBlocks > 0 ? Math.round((sharedBlksHit / totalBlocks) * 10_000) / 100 : null,
  };
}

async function listLiveQueries(query: SqlQueryListQuery): Promise<QueryStatsResult> {
  const settings = await getSettings('sqlMonitor');
  const sort = query.sort ?? 'totalMs';
  const keyword = query.keyword?.trim();
  const keywordFilter = keyword
    ? keywordCondition(keyword, [sql`query`, sql`queryid::text`], 'ilike')
    : undefined;
  try {
    const rows = (await db.execute(sql`
      SELECT current_database() AS database_name,
             queryid::text AS query_id,
             query,
             calls::bigint AS calls,
             total_exec_time::float8 AS total_ms,
             mean_exec_time::float8 AS mean_ms,
             rows::bigint AS rows,
             shared_blks_hit::bigint AS shared_blks_hit,
             shared_blks_read::bigint AS shared_blks_read,
             temp_blks_read::bigint AS temp_blks_read,
             temp_blks_written::bigint AS temp_blks_written
      FROM pg_stat_statements
      WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
        AND queryid IS NOT NULL
        ${keywordFilter ? sql`AND ${keywordFilter}` : sql``}
      ORDER BY ${sortSql(sort)} DESC
      LIMIT ${Math.min(query.limit ?? 50, settings.sampleLimit)}
    `)) as unknown as RawQueryRow[];
    return { available: true, reason: null, list: rows.map((row) => mapQuery(row, settings.queryTextMaxChars)) };
  } catch {
    return unavailable();
  }
}

async function listSessions(maxChars: number): Promise<SqlMonitorSession[]> {
  const rows = await db.execute(sql`
    SELECT pid,
           usename AS username,
           application_name,
           client_addr::text AS client_addr,
           datname AS database,
           state,
           wait_event_type,
           wait_event,
           backend_type,
           query,
           EXTRACT(EPOCH FROM (now() - query_start))::float8 AS query_seconds,
           EXTRACT(EPOCH FROM (now() - xact_start))::float8 AS transaction_seconds,
           EXTRACT(EPOCH FROM (now() - backend_start))::float8 AS backend_seconds,
           query_start,
           backend_start,
           EXTRACT(EPOCH FROM backend_start)::text AS backend_start_token,
           pg_blocking_pids(pid) AS blocked_by,
           (pid = pg_backend_pid()) AS is_current
    FROM pg_stat_activity
    WHERE datname = current_database()
    ORDER BY (state = 'active') DESC, query_start ASC NULLS LAST
  `);
  return (rows as unknown as Array<Record<string, unknown>>).map((row) => ({
    pid: Number(row.pid),
    username: (row.username as string) ?? null,
    applicationName: (row.application_name as string) || null,
    clientAddress: (row.client_addr as string) ?? null,
    database: (row.database as string) ?? null,
    state: (row.state as string) ?? null,
    waitEventType: (row.wait_event_type as string) ?? null,
    waitEvent: (row.wait_event as string) ?? null,
    backendType: (row.backend_type as string) ?? null,
    query: scrubSqlText(row.query as string | null, maxChars),
    querySeconds: row.query_seconds == null ? null : Number(row.query_seconds),
    transactionSeconds: row.transaction_seconds == null ? null : Number(row.transaction_seconds),
    backendSeconds: row.backend_seconds == null ? null : Number(row.backend_seconds),
    queryStart: formatNullableDateTime(row.query_start as Date | null),
    backendStart: formatNullableDateTime(row.backend_start as Date | null),
    backendStartToken: (row.backend_start_token as string) ?? null,
    blockedBy: Array.isArray(row.blocked_by) ? (row.blocked_by as number[]).map(Number) : [],
    isCurrent: Boolean(row.is_current),
  }));
}

async function listLocks(maxChars: number): Promise<SqlMonitorLock[]> {
  const rows = await db.execute(sql`
    SELECT blocked.pid,
           pg_blocking_pids(blocked.pid) AS blocked_by,
           CASE WHEN blocked.relation IS NULL THEN NULL ELSE blocked.relation::regclass::text END AS relation,
           blocked.locktype AS lock_type,
           blocked.mode,
           blocked.granted,
           EXTRACT(EPOCH FROM (now() - activity.query_start))::float8 AS wait_seconds,
           activity.query
    FROM pg_locks blocked
    LEFT JOIN pg_stat_activity activity ON activity.pid = blocked.pid
    WHERE NOT blocked.granted
      AND blocked.pid <> pg_backend_pid()
    ORDER BY activity.query_start ASC NULLS LAST
  `);
  return (rows as unknown as Array<Record<string, unknown>>).map((row) => ({
    pid: Number(row.pid),
    blockedBy: Array.isArray(row.blocked_by) ? (row.blocked_by as number[]).map(Number) : [],
    relation: (row.relation as string) ?? null,
    lockType: String(row.lock_type),
    mode: String(row.mode),
    granted: Boolean(row.granted),
    waitSeconds: row.wait_seconds == null ? null : Number(row.wait_seconds),
    query: scrubSqlText(row.query as string | null, maxChars),
  }));
}

async function getDatabaseCounters() {
  const rows = await db.execute(sql`
    SELECT datname,
           xact_commit::float8 AS xact_commit,
           xact_rollback::float8 AS xact_rollback,
           deadlocks::float8 AS deadlocks,
           blks_hit::float8 AS blks_hit,
           blks_read::float8 AS blks_read
    FROM pg_stat_database
    WHERE datname = current_database()
  `);
  const row = (rows as unknown as Array<Record<string, unknown>>)[0];
  if (!row) return { databaseName: null, deadlocks: 0, cacheHitRatio: null as number | null };
  const hit = Number(row.blks_hit ?? 0);
  const read = Number(row.blks_read ?? 0);
  return {
    databaseName: String(row.datname),
    deadlocks: Number(row.deadlocks ?? 0),
    cacheHitRatio: hit + read > 0 ? Math.round((hit / (hit + read)) * 10_000) / 100 : null,
  };
}

export async function getSqlMonitorOverview(): Promise<SqlMonitorOverview> {
  const settings = await getSettings('sqlMonitor');
  const [queries, sessions, counters, retentionDays, latestRows] = await Promise.all([
    listLiveQueries({ limit: 5, sort: 'totalMs' }),
    listSessions(settings.queryTextMaxChars),
    getDatabaseCounters(),
    getPolicyRetentionDays('sql_query_samples'),
    db.select({ sampledAt: sqlQuerySamples.sampledAt }).from(sqlQuerySamples).orderBy(sql`${sqlQuerySamples.sampledAt} DESC`).limit(1),
  ]);
  const activeSessions = sessions.filter((session) => session.state === 'active').length;
  const waitingSessions = sessions.filter((session) => session.waitEvent != null).length;
  const blockedSessions = sessions.filter((session) => session.blockedBy.length > 0).length;
  const calls = queries.list.reduce((sum, row) => sum + row.calls, 0);
  const totalMs = queries.list.reduce((sum, row) => sum + row.totalMs, 0);
  return {
    stats: { available: queries.available, reason: queries.reason },
    databaseName: counters.databaseName,
    sampledAt: latestRows[0]?.sampledAt ? formatDateTime(latestRows[0].sampledAt) : null,
    queryCount: queries.list.length,
    calls,
    totalMs,
    meanMs: calls > 0 ? totalMs / calls : null,
    activeSessions,
    waitingSessions,
    blockedSessions,
    deadlocks: counters.deadlocks,
    cacheHitRatio: counters.cacheHitRatio,
    sampleIntervalMinutes: settings.sampleIntervalMinutes,
    sampleRetentionDays: retentionDays,
    topQueries: queries.list,
  };
}

export async function listSqlMonitorQueries(query: SqlQueryListQuery) {
  const result = await listLiveQueries(query);
  return { stats: { available: result.available, reason: result.reason }, list: result.list };
}

export async function listSqlMonitorSessions() {
  const settings = await getSettings('sqlMonitor');
  return { list: await listSessions(settings.queryTextMaxChars) };
}

export async function listSqlMonitorLocks() {
  const settings = await getSettings('sqlMonitor');
  return { list: await listLocks(settings.queryTextMaxChars) };
}

export async function getSqlMonitorHistory(query: SqlHistoryQuery) {
  const windows: Record<string, number> = { '1h': 3600, '6h': 6 * 3600, '24h': 24 * 3600, '7d': 7 * 24 * 3600, '30d': 30 * 24 * 3600 };
  const since = new Date(Date.now() - (windows[query.range ?? '1h'] ?? 3600) * 1000);
  const rows = await db.select().from(sqlQuerySamples).where(sql`${sqlQuerySamples.sampledAt} >= ${since.toISOString()}`).orderBy(sql`${sqlQuerySamples.sampledAt} ASC`);
  const previous = new Map<string, { calls: number; totalMs: number }>();
  const points = new Map<string, SqlMonitorHistoryPoint>();
  for (const row of rows) {
    if (query.queryId && row.queryId !== query.queryId) continue;
    const previousRow = previous.get(row.queryId);
    previous.set(row.queryId, { calls: row.calls, totalMs: row.totalMs });
    if (!previousRow || row.calls < previousRow.calls || row.totalMs < previousRow.totalMs) continue;
    const calls = row.calls - previousRow.calls;
    const totalMs = row.totalMs - previousRow.totalMs;
    const sampledAt = formatDateTime(row.sampledAt);
    const point = points.get(sampledAt) ?? { sampledAt, queryCount: 0, calls: 0, totalMs: 0, meanMs: null };
    point.queryCount += 1;
    point.calls += calls;
    point.totalMs += totalMs;
    point.meanMs = point.calls > 0 ? point.totalMs / point.calls : null;
    points.set(sampledAt, point);
  }
  return { stats: { available: true, reason: null }, points: [...points.values()] };
}

async function assertSessionToken(pid: number, backendStartToken: string): Promise<void> {
  const rows = await db.execute(sql`SELECT EXTRACT(EPOCH FROM backend_start)::text AS token FROM pg_stat_activity WHERE pid = ${pid}`);
  const token = (rows as unknown as Array<{ token: string | null }>)[0]?.token;
  if (!token || token !== backendStartToken) throw new HTTPException(409, { message: '数据库会话已变化，请刷新后重试' });
}

export async function actOnSqlMonitorSession(input: { pid: number; backendStartToken: string; action: (typeof SQL_MONITOR_SESSION_ACTIONS)[number] }) {
  await assertSessionToken(input.pid, input.backendStartToken);
  const ok = input.action === 'cancel' ? await cancelBackend(input.pid) : await terminateBackend(input.pid);
  return { ok, message: ok ? (input.action === 'cancel' ? '已请求取消查询' : '已请求终止会话') : '数据库未接受该操作' };
}

export async function resetSqlMonitorStats() {
  try {
    await db.execute(sql`SELECT pg_stat_statements_reset(0, (SELECT oid FROM pg_database WHERE datname = current_database()), 0)`);
    await db.delete(sqlQuerySamples);
    return { ok: true, message: 'SQL 统计已重置，历史采样已清空' };
  } catch {
    throw new HTTPException(400, { message: '当前数据库不支持重置 pg_stat_statements，或扩展尚未启用' });
  }
}
