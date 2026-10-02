import { desc, eq } from 'drizzle-orm';
import type { QueryOutputOf } from '@arcbase/shared/core';
import { ipAccessLogContract } from '@arcbase/shared/platform';
import { db } from '../../db';
import { ipAccessLogs } from '../../db/schema';
import { buildWhere, dateRangeConditions, keywordCondition } from '../../lib/where-helpers';
import { formatDateTime } from '../../lib/datetime';
import { listRows } from '../../lib/list-query';
import { truncateVarchar } from '../../lib/sanitize';
import logger from '../../lib/logger';

export async function listIpAccessLogs(q: QueryOutputOf<typeof ipAccessLogContract.list>) {
  const { page, pageSize } = q;
  const finalWhere = buildWhere(
    keywordCondition(q.ip, [ipAccessLogs.ip]),
    q.blockType ? eq(ipAccessLogs.blockType, q.blockType) : undefined,
    ...dateRangeConditions(ipAccessLogs.createdAt, q.startTime, q.endTime),
  );
  return listRows({
    page,
    pageSize,
    table: ipAccessLogs,
    where: finalWhere,
    orderBy: [desc(ipAccessLogs.createdAt)],
    map: (r) => ({ ...r, createdAt: formatDateTime(r.createdAt), blockType: r.blockType as 'blacklist' | 'whitelist' }),
  });
}

export async function writeIpAccessLog(data: {
  ip: string;
  path: string;
  method: string;
  blockType: 'blacklist' | 'whitelist';
  userAgent?: string | null;
}) {
  try {
    // ip / path / ua 均为客户端可控输入，按列长截断；失败只告警，调用方 fire-and-forget 不受影响
    await db.insert(ipAccessLogs).values({
      ip: truncateVarchar(data.ip, 64) ?? '',
      path: truncateVarchar(data.path, 256) ?? '',
      method: truncateVarchar(data.method, 16) ?? '',
      blockType: data.blockType,
      userAgent: truncateVarchar(data.userAgent, 512),
    });
  } catch (err) {
    logger.warn('IP 访问拦截日志写入失败', { ip: data.ip?.slice(0, 64), blockType: data.blockType, error: err instanceof Error ? err.message : String(err) });
  }
}
