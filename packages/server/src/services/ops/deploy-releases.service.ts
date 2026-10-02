/**
 * 发布目录登记（deploy_releases）：主机上 releases/<name> 目录 = 还原点。
 *
 * 写入由部署流水线（登记 / 切换 current / 裁剪）与对账负责；这里是「发布备份」页的列表投影。
 */
import { asc, desc, eq, isNull } from 'drizzle-orm';
import type { QueryOutputOf } from '@arcbase/shared/core';
import { deployReleaseSchema, type DeployRelease, type deployReleaseContract } from '@arcbase/shared/ops';
import { db } from '../../db';
import { clientApps, deployReleases, deployTargets, opsHosts, type DeployReleaseRow } from '../../db/schema';
import { pickEntity } from '../../lib/entity-map';
import { buildListResult } from '../../lib/list-query';
import { buildWhere, keywordCondition, withPagination } from '../../lib/where-helpers';

export function mapDeployRelease(row: DeployReleaseRow, join: { appKey?: string; appName?: string; targetName?: string; hostName?: string } = {}): DeployRelease {
  return pickEntity(deployReleaseSchema, row, join);
}

export async function listDeployReleases(q: QueryOutputOf<typeof deployReleaseContract.list>) {
  const { page, pageSize } = q;
  const where = buildWhere(
    q.appId !== undefined ? eq(deployReleases.appId, q.appId) : undefined,
    q.targetId !== undefined ? eq(deployReleases.targetId, q.targetId) : undefined,
    q.hostId !== undefined ? eq(deployReleases.hostId, q.hostId) : undefined,
    q.includeRemoved ? undefined : isNull(deployReleases.removedAt),
    keywordCondition(q.keyword, [deployReleases.version, deployReleases.releaseName]),
  );
  const base = () => db
    .select({ release: deployReleases, appKey: clientApps.appKey, appName: clientApps.name, targetName: deployTargets.name, hostName: opsHosts.name })
    .from(deployReleases)
    .innerJoin(clientApps, eq(clientApps.id, deployReleases.appId))
    .innerJoin(deployTargets, eq(deployTargets.id, deployReleases.targetId))
    .innerJoin(opsHosts, eq(opsHosts.id, deployReleases.hostId))
    .where(where)
    .$dynamic();
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(base().as('releases')),
    rows: async () => {
      // current 置顶，其余按 release 名（= 时间前缀）倒序：同一主机最近的还原点排在前
      const rows = await withPagination(
        base().orderBy(desc(deployReleases.isCurrent), desc(deployReleases.releaseName), asc(opsHosts.name)),
        page,
        pageSize,
      );
      return rows.map((r) => mapDeployRelease(r.release, r));
    },
  });
}
