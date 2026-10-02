/**
 * 部署记录（deploy_runs）与逐行日志的读取。
 *
 * 写入（发起 / 推进 / 落日志）由 deploy-pipeline / deploy-runs-tasks 负责；这里只负责列表 / 详情 / 日志增量拉取的投影。
 */
import { HTTPException } from 'hono/http-exception';
import { asc, desc, eq, gt, isNull, or } from 'drizzle-orm';
import type { QueryOutputOf } from '@arcbase/shared/core';
import {
  deployRunHostSchema,
  deployRunLogSchema,
  deployRunSchema,
  type DeployRun,
  type DeployRunHost,
  type DeployRunLog,
  type deployRunContract,
} from '@arcbase/shared/ops';
import { db } from '../../db';
import {
  appArtifacts,
  clientApps,
  deployRunHosts,
  deployRunLogs,
  deployRuns,
  deployTargets,
  opsHosts,
  type DeployRunHostRow,
  type DeployRunLogRow,
  type DeployRunRow,
} from '../../db/schema';
import { pickEntity } from '../../lib/entity-map';
import { buildListResult } from '../../lib/list-query';
import { resolveUserNames } from '../../lib/user-nicknames';
import { buildWhere, dateRangeConditions, keywordCondition, withPagination } from '../../lib/where-helpers';

// ─── 映射 ────────────────────────────────────────────────────────────────────

interface RunJoin {
  appKey?: string;
  appName?: string;
  targetName?: string;
  artifactFileName?: string | null;
  createdByName?: string | null;
}

export function mapDeployRun(row: DeployRunRow, join: RunJoin = {}, hosts?: DeployRunHost[], withSnapshot = false): DeployRun {
  return pickEntity(deployRunSchema, row, {
    appKey: join.appKey,
    appName: join.appName,
    targetName: join.targetName,
    artifactFileName: join.artifactFileName ?? null,
    createdByName: join.createdByName ?? null,
    snapshot: withSnapshot ? row.snapshot : undefined,
    hosts,
  });
}

export function mapDeployRunHost(row: DeployRunHostRow & { hostName: string }): DeployRunHost {
  const durationMs = row.startedAt && row.finishedAt ? row.finishedAt.getTime() - row.startedAt.getTime() : null;
  return pickEntity(deployRunHostSchema, row, { hostName: row.hostName, durationMs });
}

export function mapDeployRunLog(row: DeployRunLogRow): DeployRunLog {
  return pickEntity(deployRunLogSchema, row);
}

// ─── 查询 ────────────────────────────────────────────────────────────────────

const runSelection = {
  run: deployRuns,
  appKey: clientApps.appKey,
  appName: clientApps.name,
  targetName: deployTargets.name,
  artifactFileName: appArtifacts.fileName,
};

function runQuery() {
  return db
    .select(runSelection)
    .from(deployRuns)
    .innerJoin(clientApps, eq(clientApps.id, deployRuns.appId))
    .innerJoin(deployTargets, eq(deployTargets.id, deployRuns.targetId))
    .leftJoin(appArtifacts, eq(appArtifacts.id, deployRuns.artifactId))
    .$dynamic();
}

export async function listDeployRuns(q: QueryOutputOf<typeof deployRunContract.list>) {
  const { page, pageSize } = q;
  const where = buildWhere(
    q.appId !== undefined ? eq(deployRuns.appId, q.appId) : undefined,
    q.targetId !== undefined ? eq(deployRuns.targetId, q.targetId) : undefined,
    q.releaseId !== undefined ? eq(deployRuns.appReleaseId, q.releaseId) : undefined,
    q.kind ? eq(deployRuns.kind, q.kind) : undefined,
    q.status ? eq(deployRuns.status, q.status) : undefined,
    keywordCondition(q.keyword, [deployRuns.version, deployRuns.remark, deployRuns.releaseName]),
    ...dateRangeConditions(deployRuns.createdAt, q.startTime, q.endTime),
  );
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(runQuery().where(where).as('runs')),
    rows: async () => {
      const rows = await withPagination(runQuery().where(where).orderBy(desc(deployRuns.id)), page, pageSize);
      const names = await resolveUserNames(rows.map((r) => r.run.createdBy));
      return rows.map((r) => mapDeployRun(r.run, { ...r, createdByName: r.run.createdBy ? names.get(r.run.createdBy) ?? null : null }));
    },
  });
}

export async function getDeployRun(id: number): Promise<DeployRun> {
  const [row] = await runQuery().where(eq(deployRuns.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '部署记录不存在' });
  const [hostRows, names] = await Promise.all([
    db
      .select({ host: deployRunHosts, hostName: opsHosts.name })
      .from(deployRunHosts)
      .innerJoin(opsHosts, eq(opsHosts.id, deployRunHosts.hostId))
      .where(eq(deployRunHosts.runId, id))
      .orderBy(asc(deployRunHosts.id)),
    resolveUserNames([row.run.createdBy]),
  ]);
  return mapDeployRun(
    row.run,
    { ...row, createdByName: row.run.createdBy ? names.get(row.run.createdBy) ?? null : null },
    hostRows.map((h) => mapDeployRunHost({ ...h.host, hostName: h.hostName })),
    true,
  );
}

export async function getDeployRunBeforeAudit(id: number) {
  return getDeployRun(id);
}

/** 日志按 seq 增量：afterSeq 之后的行，hostId 给出时同时带 run 级（hostId 为空）的行 */
export async function listDeployRunLogs(runId: number, q: QueryOutputOf<typeof deployRunContract.logs>): Promise<DeployRunLog[]> {
  const exists = await db.$count(deployRuns, eq(deployRuns.id, runId));
  if (exists === 0) throw new HTTPException(404, { message: '部署记录不存在' });
  const rows = await db
    .select()
    .from(deployRunLogs)
    .where(buildWhere(
      eq(deployRunLogs.runId, runId),
      gt(deployRunLogs.seq, q.afterSeq),
      q.hostId !== undefined ? or(eq(deployRunLogs.hostId, q.hostId), isNull(deployRunLogs.hostId)) : undefined,
    ))
    .orderBy(asc(deployRunLogs.seq))
    .limit(q.limit);
  return rows.map(mapDeployRunLog);
}
