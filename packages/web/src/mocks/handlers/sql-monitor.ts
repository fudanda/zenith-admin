import { sqlMonitorContract } from '@arcbase/shared/platform';
import { mock } from '@/mocks/utils/contract';
import { sqlMonitorHistory, sqlMonitorLocks, sqlMonitorQueries, sqlMonitorSessions, getSqlMonitorOverview } from '@/mocks/data/sql-monitor';

export const sqlMonitorHandlers = [
  mock(sqlMonitorContract.overview, ({ ok }) => ok(getSqlMonitorOverview(), 'success')),

  mock(sqlMonitorContract.queries, ({ query, ok }) => {
    const keyword = query.keyword?.trim().toLowerCase();
    const list = [...sqlMonitorQueries]
      .filter((item) => !keyword || item.queryId.toLowerCase().includes(keyword) || item.query?.toLowerCase().includes(keyword))
      .sort((a, b) => {
        const sort = query.sort ?? 'totalMs';
        return (b[sort] as number) - (a[sort] as number);
      })
      .slice(0, query.limit ?? 50);
    return ok({ stats: { available: true, reason: null }, list }, 'success');
  }),

  mock(sqlMonitorContract.sessions, ({ ok }) => ok({ list: sqlMonitorSessions }, 'success')),
  mock(sqlMonitorContract.locks, ({ ok }) => ok({ list: sqlMonitorLocks }, 'success')),

  mock(sqlMonitorContract.history, ({ ok }) => ok({
    stats: { available: true, reason: null },
    points: sqlMonitorHistory,
  }, 'success')),

  mock(sqlMonitorContract.sessionAction, ({ body, ok }) => {
    const session = sqlMonitorSessions.find((item) => item.pid === body.pid && item.backendStartToken === body.backendStartToken);
    if (!session) {
      return ok({ ok: false, message: '会话不存在或已发生变化' }, '会话不存在或已发生变化');
    }
    if (body.action === 'cancel') {
      session.query = null;
      session.state = 'idle';
      session.querySeconds = null;
      return ok({ ok: true, message: `已取消 PID ${body.pid} 的查询` }, `已取消 PID ${body.pid} 的查询`);
    }
    const index = sqlMonitorSessions.indexOf(session);
    if (index >= 0) sqlMonitorSessions.splice(index, 1);
    const lockIndex = sqlMonitorLocks.findIndex((item) => item.pid === body.pid);
    if (lockIndex >= 0) sqlMonitorLocks.splice(lockIndex, 1);
    return ok({ ok: true, message: `已终止 PID ${body.pid} 的会话` }, `已终止 PID ${body.pid} 的会话`);
  }),

  mock(sqlMonitorContract.reset, ({ ok }) => {
    sqlMonitorQueries.forEach((item) => {
      item.calls = 0;
      item.totalMs = 0;
      item.meanMs = 0;
      item.rows = 0;
      item.sharedBlksHit = 0;
      item.sharedBlksRead = 0;
      item.tempBlksRead = 0;
      item.tempBlksWritten = 0;
    });
    return ok({ ok: true, message: 'SQL 统计已重置' }, 'SQL 统计已重置');
  }),
];
