/**
 * 部署目标（应用 × 环境）：主机组、部署根目录、重启方式、健康检查、保留策略。
 *
 * 目标是「应用部署」的配置实体；每次 run 发起时把配置快照进 deploy_runs.snapshot，之后改配置不影响历史记录。
 * 列表 / 详情附带各主机当前版本（deploy_releases.isCurrent）与最近一次 run 摘要，运维最常看的"每个环境跑的是哪版"一屏可见。
 * 平台级资源，不挂租户。
 */
import { HTTPException } from 'hono/http-exception';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { QueryOutputOf } from '@arcbase/shared/core';
import {
  deployTargetSchema,
  validateDeployRestartConfig,
  type CreateDeployTargetInput,
  type DeployHealthCheck,
  type DeployRunBrief,
  type DeployScripts,
  type DeployTarget,
  type DeployTargetHost,
  type UpdateDeployTargetInput,
  type deployTargetContract,
} from '@arcbase/shared/ops';
import { db } from '../../db';
import {
  clientApps,
  deployReleases,
  deployRuns,
  deployTargetHosts,
  deployTargets,
  opsHosts,
  type DeployTargetRow,
} from '../../db/schema';
import { requireFirstRow } from '../../lib/db-assert';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { pickEntity } from '../../lib/entity-map';
import { buildWhere, keywordCondition } from '../../lib/where-helpers';

// ─── 映射 ────────────────────────────────────────────────────────────────────

interface TargetExtras {
  appKey?: string;
  appName?: string;
  hosts: DeployTargetHost[];
  lastRun: DeployRunBrief | null;
}

export function mapDeployTarget(row: DeployTargetRow, extras: TargetExtras): DeployTarget {
  return pickEntity(deployTargetSchema, row, {
    appKey: extras.appKey,
    appName: extras.appName,
    hosts: extras.hosts,
    lastRun: extras.lastRun,
  });
}

/** 一批目标的主机（含当前版本）与最近一次 run；目标数量少，按 id 集合两次查询即可 */
async function loadTargetExtras(targetIds: number[]): Promise<Map<number, Omit<TargetExtras, 'appKey' | 'appName'>>> {
  const map = new Map<number, Omit<TargetExtras, 'appKey' | 'appName'>>();
  for (const id of targetIds) map.set(id, { hosts: [], lastRun: null });
  if (targetIds.length === 0) return map;

  const [hostRows, currentRows, lastRuns] = await Promise.all([
    db
      .select({
        targetId: deployTargetHosts.targetId,
        hostId: deployTargetHosts.hostId,
        order: deployTargetHosts.order,
        hostName: opsHosts.name,
        host: opsHosts.host,
        hostEnabled: opsHosts.enabled,
      })
      .from(deployTargetHosts)
      .innerJoin(opsHosts, eq(opsHosts.id, deployTargetHosts.hostId))
      .where(inArray(deployTargetHosts.targetId, targetIds))
      .orderBy(asc(deployTargetHosts.order), asc(deployTargetHosts.hostId)),
    db
      .select({
        targetId: deployReleases.targetId,
        hostId: deployReleases.hostId,
        version: deployReleases.version,
        releaseName: deployReleases.releaseName,
        createdAt: deployReleases.createdAt,
        currentSince: deployReleases.currentSince,
      })
      .from(deployReleases)
      .where(and(inArray(deployReleases.targetId, targetIds), eq(deployReleases.isCurrent, true))),
    db
      .selectDistinctOn([deployRuns.targetId], {
        id: deployRuns.id,
        targetId: deployRuns.targetId,
        kind: deployRuns.kind,
        status: deployRuns.status,
        version: deployRuns.version,
        finishedAt: deployRuns.finishedAt,
        createdAt: deployRuns.createdAt,
      })
      .from(deployRuns)
      .where(inArray(deployRuns.targetId, targetIds))
      .orderBy(deployRuns.targetId, desc(deployRuns.createdAt), desc(deployRuns.id)),
  ]);

  const currentByKey = new Map(currentRows.map((r) => [`${r.targetId}:${r.hostId}`, r]));
  for (const h of hostRows) {
    const current = currentByKey.get(`${h.targetId}:${h.hostId}`);
    map.get(h.targetId)?.hosts.push({
      hostId: h.hostId,
      hostName: h.hostName,
      host: h.host,
      order: h.order,
      hostEnabled: h.hostEnabled,
      currentVersion: current?.version ?? null,
      currentReleaseName: current?.releaseName ?? null,
      currentSince: current ? formatDateTime(current.currentSince ?? current.createdAt) : null,
    });
  }
  for (const r of lastRuns) {
    const entry = map.get(r.targetId);
    if (entry) {
      entry.lastRun = {
        id: r.id,
        kind: r.kind,
        status: r.status,
        version: r.version,
        finishedAt: formatNullableDateTime(r.finishedAt),
        createdAt: formatDateTime(r.createdAt),
      };
    }
  }
  return map;
}

// ─── 查询 ────────────────────────────────────────────────────────────────────

type TargetListFilter = QueryOutputOf<typeof deployTargetContract.list>;

export async function listDeployTargets(q: TargetListFilter): Promise<DeployTarget[]> {
  const where = buildWhere(
    q.appId !== undefined ? eq(deployTargets.appId, q.appId) : undefined,
    q.enabled !== undefined ? eq(deployTargets.enabled, q.enabled) : undefined,
    keywordCondition(q.keyword, [deployTargets.name, clientApps.name, clientApps.appKey]),
  );
  const rows = await db
    .select({ target: deployTargets, appKey: clientApps.appKey, appName: clientApps.name })
    .from(deployTargets)
    .innerJoin(clientApps, eq(clientApps.id, deployTargets.appId))
    .where(where)
    .orderBy(asc(clientApps.name), asc(deployTargets.id));
  const extras = await loadTargetExtras(rows.map((r) => r.target.id));
  return rows.map((r) => mapDeployTarget(r.target, { appKey: r.appKey, appName: r.appName, ...extras.get(r.target.id)! }));
}

export async function ensureDeployTargetExists(id: number): Promise<DeployTargetRow> {
  return requireFirstRow(db.select().from(deployTargets).where(eq(deployTargets.id, id)).limit(1), '部署目标不存在');
}

export async function getDeployTarget(id: number): Promise<DeployTarget> {
  const [row] = await db
    .select({ target: deployTargets, appKey: clientApps.appKey, appName: clientApps.name })
    .from(deployTargets)
    .innerJoin(clientApps, eq(clientApps.id, deployTargets.appId))
    .where(eq(deployTargets.id, id))
    .limit(1);
  if (!row) throw new HTTPException(404, { message: '部署目标不存在' });
  const extras = await loadTargetExtras([id]);
  return mapDeployTarget(row.target, { appKey: row.appKey, appName: row.appName, ...extras.get(id)! });
}

export async function getDeployTargetBeforeAudit(id: number) {
  return getDeployTarget(id);
}

/** 目标里启用的主机（按推进顺序），供发起 run 时展开；hostIds 给出子集时校验全部属于该目标 */
export async function resolveTargetHosts(targetId: number, hostIds?: number[]) {
  const rows = await db
    .select({ hostId: deployTargetHosts.hostId, order: deployTargetHosts.order, hostName: opsHosts.name, enabled: opsHosts.enabled })
    .from(deployTargetHosts)
    .innerJoin(opsHosts, eq(opsHosts.id, deployTargetHosts.hostId))
    .where(eq(deployTargetHosts.targetId, targetId))
    .orderBy(asc(deployTargetHosts.order), asc(deployTargetHosts.hostId));
  if (hostIds) {
    const bound = new Set(rows.map((r) => r.hostId));
    const stranger = hostIds.find((id) => !bound.has(id));
    if (stranger !== undefined) throw new HTTPException(400, { message: `主机 #${stranger} 不属于该部署目标` });
    return rows.filter((r) => hostIds.includes(r.hostId));
  }
  return rows.filter((r) => r.enabled);
}

// ─── 写入 ────────────────────────────────────────────────────────────────────

/** 入参里的可缺省字段归一为列上的 null（jsonb 列类型要求每个键都在） */
function normalizeHealthCheck(input: NonNullable<UpdateDeployTargetInput['healthCheck']>): DeployHealthCheck {
  return {
    type: input.type,
    url: input.type === 'http' ? input.url ?? null : null,
    port: input.type === 'tcp' ? input.port ?? null : null,
    command: input.type === 'command' ? input.command ?? null : null,
    timeoutSeconds: input.timeoutSeconds,
    retries: input.retries,
    intervalSeconds: input.intervalSeconds,
  };
}

function normalizeScripts(input: NonNullable<UpdateDeployTargetInput['scripts']>): DeployScripts {
  return {
    beforeSwitch: input.beforeSwitch?.trim() ? input.beforeSwitch : null,
    restart: input.restart?.trim() ? input.restart : null,
  };
}

function toTargetColumns(input: Omit<UpdateDeployTargetInput, 'hostIds'>) {
  const { healthCheck, scripts, serviceName, ...rest } = input;
  return {
    ...rest,
    ...(healthCheck !== undefined ? { healthCheck: normalizeHealthCheck(healthCheck) } : {}),
    ...(scripts !== undefined ? { scripts: normalizeScripts(scripts) } : {}),
    ...(serviceName !== undefined ? { serviceName: serviceName ?? null } : {}),
  };
}

async function ensureServiceApp(appId: number) {
  const app = await requireFirstRow(db.select().from(clientApps).where(eq(clientApps.id, appId)).limit(1), '应用不存在');
  if (app.kind !== 'service') throw new HTTPException(400, { message: '只有服务端应用（kind = service）可以配置部署目标' });
  return app;
}

async function ensureHostsExist(hostIds: number[]) {
  const rows = await db.select({ id: opsHosts.id }).from(opsHosts).where(inArray(opsHosts.id, hostIds));
  const found = new Set(rows.map((r) => r.id));
  const missing = hostIds.find((id) => !found.has(id));
  if (missing !== undefined) throw new HTTPException(400, { message: `主机 #${missing} 不存在` });
}

export async function createDeployTarget(input: CreateDeployTargetInput): Promise<DeployTarget> {
  await ensureServiceApp(input.appId);
  await ensureHostsExist(input.hostIds);
  const { hostIds, healthCheck, scripts, serviceName, ...rest } = input;
  try {
    const id = await db.transaction(async (tx) => {
      const [row] = await tx.insert(deployTargets).values({
        ...rest,
        healthCheck: normalizeHealthCheck(healthCheck),
        scripts: normalizeScripts(scripts),
        serviceName: serviceName ?? null,
      }).returning({ id: deployTargets.id });
      await tx.insert(deployTargetHosts).values(hostIds.map((hostId, order) => ({ targetId: row.id, hostId, order })));
      return row.id;
    });
    return getDeployTarget(id);
  } catch (err) {
    rethrowPgUniqueViolation(err, '该应用下已存在同名部署目标');
    throw err;
  }
}

export async function updateDeployTarget(id: number, input: UpdateDeployTargetInput): Promise<DeployTarget> {
  const existing = await ensureDeployTargetExists(id);
  const { hostIds, ...values } = input;
  const columns = toTargetColumns(values);
  // 局部提交：与现有配置合并后再校验重启方式与配套字段的联动
  const error = validateDeployRestartConfig({
    restartMode: columns.restartMode ?? existing.restartMode,
    serviceName: columns.serviceName === undefined ? existing.serviceName : columns.serviceName,
    scripts: columns.scripts ?? existing.scripts,
  });
  if (error) throw new HTTPException(400, { message: error });
  if (hostIds) await ensureHostsExist(hostIds);
  try {
    await db.transaction(async (tx) => {
      if (Object.keys(columns).length > 0) await tx.update(deployTargets).set(columns).where(eq(deployTargets.id, id));
      if (hostIds) {
        await tx.delete(deployTargetHosts).where(eq(deployTargetHosts.targetId, id));
        await tx.insert(deployTargetHosts).values(hostIds.map((hostId, order) => ({ targetId: id, hostId, order })));
      }
    });
  } catch (err) {
    rethrowPgUniqueViolation(err, '该应用下已存在同名部署目标');
    throw err;
  }
  return getDeployTarget(id);
}

export async function deleteDeployTarget(id: number): Promise<void> {
  await ensureDeployTargetExists(id);
  const active = await db.$count(deployRuns, and(eq(deployRuns.targetId, id), inArray(deployRuns.status, ['pending', 'running'])));
  if (active > 0) throw new HTTPException(400, { message: '该目标有进行中的部署，请等待结束后再删除' });
  // 只删登记：主机上的 releases/ current 保留，避免误删线上运行目录
  await db.delete(deployTargets).where(eq(deployTargets.id, id));
}
