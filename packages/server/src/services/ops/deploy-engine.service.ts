/**
 * 应用部署引擎：发起 / 重试 / 取消 run，任务中心 handler 驱动逐主机流水线，维护 deploy_releases 登记表。
 *
 * 执行模型：
 * - 发起时把 run + 主机行 + 任务中心任务在一个事务里落库（目标级互斥由 deploy_runs_target_active_unique 保证），提交后投递；
 * - worker 领取任务后按策略（滚动 / 并行）对每台主机跑 deploy-pipeline；主机状态 / 步骤 / 日志实时落库并推送发起人；
 * - 主机成功后在同一事务里更新 deploy_releases（新 release 登记、isCurrent 翻转、被清理的标记 removedAt）；
 * - 任务被兜底回收后重投时（attempt > 1）从库里的主机状态续跑：已成功的跳过，其余重跑（流水线各步幂等）。
 *
 * 任务中心心跳每 90s 判卡死，而上传 / 钩子可能远超 90s，所以 handler 用独立定时器持续 progress() 续心跳。
 */
import { and, asc, eq, inArray, max, ne, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import {
  DEPLOY_RUN_KIND_LABELS,
  DEPLOY_RUN_STATUS_LABELS,
  DEPLOY_STEP_LABELS,
  type CreateDeployRunInput,
  type DeployHostStatus,
  type DeployLogLevel,
  type DeployRun,
  type DeployRunLog,
  type DeployRunSnapshot,
  type DeployRunStatus,
  type DeployStep,
  type DeployTargetSyncResult,
} from '@arcbase/shared/ops';
import { ASYNC_TASK_TERMINAL_STATUSES } from '@arcbase/shared/tasks';
import { db } from '../../db';
import {
  appArtifacts,
  appReleases,
  asyncTasks,
  clientApps,
  deployReleases,
  deployRunHosts,
  deployRunLogs,
  deployRuns,
  deployTargets,
  opsHosts,
  type DeployRunHostRow,
  type DeployRunRow,
  type DeployTargetRow,
} from '../../db/schema';
import type { DbTransaction } from '../../db/types';
import { mapWithConcurrency } from '../../lib/concurrency';
import { currentUser } from '../../lib/context';
import { isPgUniqueViolation } from '../../lib/db-errors';
import { readStoredFile } from '../../lib/file-storage';
import { getRemoteExecutor, type RemoteHostExecutor } from '../../lib/host-exec';
import logger from '../../lib/logger';
import { registerTaskHandler } from '../../lib/task-center/registry';
import { enqueueAsyncTask, persistAsyncTask, requestCancelAsyncTask } from '../../lib/task-center/runner';
import type { TaskRunContext } from '../../lib/task-center/types';
import { sendToUser } from '../../lib/ws-manager';
import { getRestrictedFileForRead } from '../files/files.service';
import { notify } from '../messaging/notification-outbox.service';
import {
  DeployCancelledError,
  DeployStepError,
  inspectHostReleases,
  releaseNameFor,
  removeHostRelease,
  runHostPipeline,
  versionFromReleaseName,
  type PipelineArtifact,
} from './deploy-pipeline';
import { getDeployRun, mapDeployRunLog } from './deploy-runs.service';
import { ensureDeployTargetExists, getDeployTarget, resolveTargetHosts } from './deploy-targets.service';

export const DEPLOY_RUN_TASK_TYPE = 'deploy-run';

const HEARTBEAT_INTERVAL_MS = 30_000;
const LOG_PUSH_INTERVAL_MS = 500;
/** pending 超过该时长仍无任务 / 任务已终态的 run 视为孤儿，发起新 run 前先收尾 */
const ORPHAN_PENDING_MS = 10 * 60_000;

// ─── 发起 ────────────────────────────────────────────────────────────────────

function snapshotOf(target: DeployTargetRow): DeployRunSnapshot {
  return {
    deployPath: target.deployPath,
    sharedPaths: target.sharedPaths,
    keepReleases: target.keepReleases,
    restartMode: target.restartMode,
    serviceName: target.serviceName,
    scripts: target.scripts,
    healthCheck: target.healthCheck,
    env: target.env,
    autoRollback: target.autoRollback,
    strategy: target.strategy,
    maxParallel: target.maxParallel,
    stopOnFailure: target.stopOnFailure,
  };
}

/** 版本须已发布，且含 server 平台的部署包制品（多个时按 artifactId 指定） */
async function resolveDeployArtifact(appId: number, releaseId: number, artifactId?: number) {
  const [release] = await db.select().from(appReleases).where(and(eq(appReleases.id, releaseId), eq(appReleases.appId, appId))).limit(1);
  if (!release) throw new HTTPException(400, { message: '应用版本不存在或不属于该应用' });
  if (release.status !== 'published') throw new HTTPException(400, { message: `版本 ${release.version} 尚未发布，只能部署已发布的版本` });
  const candidates = await db.select().from(appArtifacts)
    .where(and(eq(appArtifacts.releaseId, releaseId), eq(appArtifacts.platform, 'server'), eq(appArtifacts.kind, 'archive')))
    .orderBy(asc(appArtifacts.id));
  const usable = candidates.filter((a) => a.fileId);
  if (usable.length === 0) throw new HTTPException(400, { message: `版本 ${release.version} 没有可用的部署包制品（platform = server，kind = archive，且文件仍在）` });
  const artifact = artifactId !== undefined ? usable.find((a) => a.id === artifactId) : usable.length === 1 ? usable[0] : undefined;
  if (!artifact) {
    throw new HTTPException(400, {
      message: artifactId !== undefined ? '指定的制品不存在或不是部署包' : `版本 ${release.version} 有 ${usable.length} 个部署包制品，请指定 artifactId`,
    });
  }
  return { release, artifact };
}

interface RunPlan {
  target: DeployTargetRow;
  kind: CreateDeployRunInput['kind'];
  hostIds: number[];
  appReleaseId: number | null;
  version: string | null;
  artifactId: number | null;
  releaseName: string | null;
  remark: string | null;
}

async function insertRunWithTask(plan: RunPlan): Promise<DeployRunRow> {
  const { target } = plan;
  const kindLabel = DEPLOY_RUN_KIND_LABELS[plan.kind];
  const [app] = await db.select({ name: clientApps.name }).from(clientApps).where(eq(clientApps.id, target.appId)).limit(1);
  const title = `${kindLabel}：${app?.name ?? `应用 #${target.appId}`} ${plan.version ?? plan.releaseName ?? ''} → ${target.name}`.trim();
  let row: DeployRunRow;
  try {
    row = await db.transaction(async (tx) => {
      const [run] = await tx.insert(deployRuns).values({
        appId: target.appId,
        targetId: target.id,
        kind: plan.kind,
        status: 'pending',
        appReleaseId: plan.appReleaseId,
        version: plan.version,
        artifactId: plan.artifactId,
        releaseName: plan.releaseName,
        snapshot: snapshotOf(target),
        hostTotal: plan.hostIds.length,
        remark: plan.remark,
      }).returning();
      await tx.insert(deployRunHosts).values(plan.hostIds.map((hostId) => ({ runId: run.id, hostId, status: 'pending' as const })));
      const task = await persistAsyncTask(tx, {
        taskType: DEPLOY_RUN_TASK_TYPE,
        title: title.slice(0, 128),
        payload: { runId: run.id, targetId: target.id, kind: plan.kind },
      });
      const [withTask] = await tx.update(deployRuns).set({ asyncTaskId: task.id }).where(eq(deployRuns.id, run.id)).returning();
      return withTask;
    });
  } catch (err) {
    if (isPgUniqueViolation(err)) throw new HTTPException(400, { message: `部署目标「${target.name}」已有进行中的部署，请等待其结束` });
    throw err;
  }
  if (row.asyncTaskId) {
    await enqueueAsyncTask(row.asyncTaskId).catch((err) => {
      logger.error(`[deploy] run #${row.id} 任务 #${row.asyncTaskId} 入队失败，等待 pending 扫描补投`, err);
    });
  }
  return row;
}

/**
 * 发起新 run 前收尾孤儿：任务已终态（被兜底判失败 / 取消）但 run 仍 pending / running 的，或 pending 太久没任务的。
 * 否则互斥索引会把目标永久锁死。
 */
async function reapOrphanRuns(targetId: number): Promise<void> {
  const active = await db
    .select({ run: deployRuns, taskStatus: asyncTasks.status, taskError: asyncTasks.errorMessage })
    .from(deployRuns)
    .leftJoin(asyncTasks, eq(asyncTasks.id, deployRuns.asyncTaskId))
    .where(and(eq(deployRuns.targetId, targetId), inArray(deployRuns.status, ['pending', 'running'])));
  for (const { run, taskStatus, taskError } of active) {
    const taskGone = taskStatus === null || (ASYNC_TASK_TERMINAL_STATUSES as readonly string[]).includes(taskStatus);
    const pendingTooLong = run.status === 'pending' && Date.now() - run.createdAt.getTime() > ORPHAN_PENDING_MS;
    if (!taskGone && !pendingTooLong) continue;
    const status: DeployRunStatus = taskStatus === 'cancelled' ? 'cancelled' : 'failed';
    const error = taskStatus === null
      ? '任务中心任务不存在，run 已被收尾'
      : `任务中心任务已${taskStatus === 'cancelled' ? '取消' : '结束'}（${taskError ?? taskStatus}），run 已被收尾`;
    await db.transaction(async (tx) => {
      await tx.update(deployRunHosts)
        .set({ status: status === 'cancelled' ? 'cancelled' : 'failed', finishedAt: new Date(), error })
        .where(and(eq(deployRunHosts.runId, run.id), inArray(deployRunHosts.status, ['pending', 'running'])));
      await finalizeRunRow(tx, run.id, status, error);
    });
    logger.warn(`[deploy] 收尾孤儿 run #${run.id}（${error}）`);
  }
}

export async function createDeployRun(input: CreateDeployRunInput): Promise<DeployRun> {
  const target = await ensureDeployTargetExists(input.targetId);
  if (!target.enabled) throw new HTTPException(400, { message: `部署目标「${target.name}」已停用` });
  const hosts = await resolveTargetHosts(input.targetId, input.hostIds);
  if (hosts.length === 0) throw new HTTPException(400, { message: '该目标下没有可用（已启用）的主机' });
  const disabled = hosts.find((h) => !h.enabled);
  if (disabled) throw new HTTPException(400, { message: `主机「${disabled.hostName}」已停用，请先在主机管理中启用或从本次部署中排除` });
  await reapOrphanRuns(target.id);

  const base = { target, hostIds: hosts.map((h) => h.hostId), remark: input.remark?.trim() || null };
  let plan: RunPlan;
  if (input.kind === 'deploy') {
    const { release, artifact } = await resolveDeployArtifact(target.appId, input.releaseId, input.artifactId);
    plan = { ...base, kind: 'deploy', appReleaseId: release.id, version: release.version, artifactId: artifact.id, releaseName: releaseNameFor(release.version, new Date()) };
  } else if (input.kind === 'rollback') {
    // 回滚目标须是登记表里、在所选每台主机上都还存在的 release
    const rows = await db.select().from(deployReleases).where(and(
      eq(deployReleases.targetId, target.id),
      eq(deployReleases.releaseName, input.releaseName),
      inArray(deployReleases.hostId, base.hostIds),
    ));
    const present = new Set(rows.filter((r) => !r.removedAt).map((r) => r.hostId));
    const missing = hosts.find((h) => !present.has(h.hostId));
    if (missing) throw new HTTPException(400, { message: `主机「${missing.hostName}」上不存在 release ${input.releaseName}（未部署过或已清理）` });
    const sample = rows[0];
    plan = { ...base, kind: 'rollback', appReleaseId: sample.appReleaseId, version: sample.version, artifactId: sample.artifactId, releaseName: input.releaseName };
  } else {
    plan = { ...base, kind: 'restart', appReleaseId: null, version: null, artifactId: null, releaseName: null };
  }
  const row = await insertRunWithTask(plan);
  return getDeployRun(row.id);
}

/** 对失败 / 回滚 / 跳过 / 取消的主机以同参数再发起一次 run */
export async function retryDeployRun(id: number): Promise<DeployRun> {
  const [run] = await db.select().from(deployRuns).where(eq(deployRuns.id, id)).limit(1);
  if (!run) throw new HTTPException(404, { message: '部署记录不存在' });
  if (run.status === 'pending' || run.status === 'running') throw new HTTPException(400, { message: '该部署仍在进行中' });
  const hostRows = await db.select().from(deployRunHosts).where(and(
    eq(deployRunHosts.runId, id),
    inArray(deployRunHosts.status, ['failed', 'rolled_back', 'skipped', 'cancelled']),
  ));
  if (hostRows.length === 0) throw new HTTPException(400, { message: '该部署没有需要重试的主机' });
  const target = await ensureDeployTargetExists(run.targetId);
  if (!target.enabled) throw new HTTPException(400, { message: `部署目标「${target.name}」已停用` });
  const hosts = await resolveTargetHosts(run.targetId, hostRows.map((h) => h.hostId));
  const disabled = hosts.find((h) => !h.enabled);
  if (disabled) throw new HTTPException(400, { message: `主机「${disabled.hostName}」已停用` });
  if (run.kind === 'deploy') {
    if (!run.appReleaseId || !run.artifactId) throw new HTTPException(400, { message: '原版本或制品已被删除，无法重试' });
    await resolveDeployArtifact(run.appId, run.appReleaseId, run.artifactId);
  }
  await reapOrphanRuns(target.id);
  const row = await insertRunWithTask({
    target,
    kind: run.kind,
    hostIds: hosts.map((h) => h.hostId),
    appReleaseId: run.appReleaseId,
    version: run.version,
    artifactId: run.artifactId,
    // deploy 重试沿用同一 release 名：已上传 / 解包过的主机可直接复用目录
    releaseName: run.releaseName,
    remark: `重试 #${run.id}${run.remark ? `：${run.remark}` : ''}`.slice(0, 500),
  });
  return getDeployRun(row.id);
}

export async function cancelDeployRun(id: number): Promise<DeployRun> {
  const [run] = await db.select().from(deployRuns).where(eq(deployRuns.id, id)).limit(1);
  if (!run) throw new HTTPException(404, { message: '部署记录不存在' });
  if (run.status !== 'pending' && run.status !== 'running') throw new HTTPException(400, { message: '该部署已结束' });
  if (run.asyncTaskId) await requestCancelAsyncTask(run.asyncTaskId);
  if (run.status === 'pending') {
    // 还没被 worker 领取：直接收尾，不等 handler
    await db.transaction(async (tx) => {
      await tx.update(deployRunHosts).set({ status: 'cancelled', finishedAt: new Date() })
        .where(and(eq(deployRunHosts.runId, id), eq(deployRunHosts.status, 'pending')));
      await finalizeRunRow(tx, id, 'cancelled', null, { onlyIfPending: true });
    });
  }
  return getDeployRun(id);
}

// ─── run 行状态 ───────────────────────────────────────────────────────────────

async function finalizeRunRow(tx: DbTransaction, runId: number, status: DeployRunStatus, error: string | null, opts: { onlyIfPending?: boolean } = {}) {
  const counts = await tx
    .select({ status: deployRunHosts.status, n: sql<number>`count(*)::int` })
    .from(deployRunHosts)
    .where(eq(deployRunHosts.runId, runId))
    .groupBy(deployRunHosts.status);
  const count = (s: DeployHostStatus) => counts.find((c) => c.status === s)?.n ?? 0;
  const [row] = await tx.update(deployRuns)
    .set({
      status,
      error,
      hostSucceeded: count('succeeded'),
      hostFailed: count('failed') + count('rolled_back'),
      finishedAt: new Date(),
      startedAt: sql`coalesce(${deployRuns.startedAt}, now())`,
    })
    .where(and(eq(deployRuns.id, runId), inArray(deployRuns.status, opts.onlyIfPending ? ['pending'] : ['pending', 'running'])))
    .returning();
  return row ?? null;
}

// ─── 任务 handler ─────────────────────────────────────────────────────────────

interface RunContext {
  run: DeployRunRow;
  target: DeployTargetRow;
  appKey: string;
  appName: string;
  hostNames: Map<number, string>;
  ctx: TaskRunContext;
  cancelRequested: boolean;
  /** 任务已被别的流程接管（兜底回收 / 状态被改），本次执行不得再写终态 */
  takenOver: boolean;
  seq: number;
  pendingLogs: DeployRunLog[];
}

function pushRunUpdate(rc: RunContext, status: DeployRunStatus, host?: { hostId: number; hostStatus: DeployHostStatus }) {
  if (!rc.run.createdBy) return;
  sendToUser(rc.run.createdBy, { type: 'deploy:run-updated', payload: { runId: rc.run.id, status, ...host } });
}

/** 记下取消：区分「用户请求取消」与「任务被兜底回收 / 状态被改」（后者本次执行不得再写终态） */
async function markCancelled(rc: RunContext) {
  if (rc.cancelRequested) return;
  rc.cancelRequested = true;
  const [task] = await db.select({ status: asyncTasks.status }).from(asyncTasks).where(eq(asyncTasks.id, rc.ctx.taskId)).limit(1);
  if (!task || task.status !== 'running') rc.takenOver = true;
  await appendLog(rc, null, 'warn', null, rc.takenOver
    ? '任务已被回收（worker 心跳超时），本次执行停止；将由重投的任务续跑'
    : '收到取消请求：当前主机完成手头步骤后停止（已切换版本的主机继续完成重启与健康检查），未开始的主机不再执行');
}

/** 每个步骤入口实时探测取消，不等 30s 心跳 */
async function isRunCancelled(rc: RunContext): Promise<boolean> {
  if (rc.cancelRequested) return true;
  if (await rc.ctx.isCancelRequested()) await markCancelled(rc);
  return rc.cancelRequested;
}

function flushLogs(rc: RunContext) {
  if (rc.pendingLogs.length === 0 || !rc.run.createdBy) {
    rc.pendingLogs = [];
    return;
  }
  const logs = rc.pendingLogs;
  rc.pendingLogs = [];
  sendToUser(rc.run.createdBy, { type: 'deploy:log', payload: { runId: rc.run.id, logs } });
}

async function appendLog(rc: RunContext, hostId: number | null, level: DeployLogLevel, step: DeployStep | null, line: string) {
  const seq = ++rc.seq;
  const [row] = await db.insert(deployRunLogs).values({ runId: rc.run.id, hostId, seq, level, step, line: line.slice(0, 4000) }).returning();
  rc.pendingLogs.push(mapDeployRunLog(row));
}

async function setHostState(rc: RunContext, hostId: number, patch: Partial<typeof deployRunHosts.$inferInsert>, notifyStatus?: DeployHostStatus) {
  await db.update(deployRunHosts).set(patch).where(and(eq(deployRunHosts.runId, rc.run.id), eq(deployRunHosts.hostId, hostId)));
  if (notifyStatus) pushRunUpdate(rc, 'running', { hostId, hostStatus: notifyStatus });
}

function buildArtifact(rc: RunContext, artifact: { fileId: string | null; fileName: string; size: number; sha256: string | null }): PipelineArtifact {
  return {
    fileName: artifact.fileName,
    size: artifact.size,
    sha256: artifact.sha256,
    open: async () => {
      if (!artifact.fileId) throw new Error('制品文件已被删除');
      const { file, storageConfig } = await getRestrictedFileForRead(artifact.fileId);
      const { stream } = await readStoredFile(file, storageConfig);
      return stream;
    },
  };
}

/** 主机成功后维护登记表：deploy 新增 + 翻转 current + 标记被清理的；rollback 翻转 current */
async function recordHostRelease(rc: RunContext, hostId: number, result: { previousReleaseName: string | null; sizeBytes: number | null; prunedReleaseNames: string[] }) {
  const { run } = rc;
  const effective = run.kind === 'restart' ? result.previousReleaseName : run.releaseName;
  if (!effective) return;
  await db.transaction(async (tx) => {
    const now = new Date();
    await tx.update(deployReleases).set({ isCurrent: false })
      .where(and(eq(deployReleases.targetId, run.targetId), eq(deployReleases.hostId, hostId), eq(deployReleases.isCurrent, true), ne(deployReleases.releaseName, effective)));
    await tx.insert(deployReleases).values({
      appId: run.appId,
      targetId: run.targetId,
      hostId,
      releaseName: effective,
      version: run.version ?? versionFromReleaseName(effective) ?? 'unknown',
      appReleaseId: run.appReleaseId,
      artifactId: run.artifactId,
      runId: run.id,
      isCurrent: true,
      currentSince: now,
      sizeBytes: result.sizeBytes,
      removedAt: null,
    }).onConflictDoUpdate({
      target: [deployReleases.targetId, deployReleases.hostId, deployReleases.releaseName],
      set: {
        isCurrent: true,
        // 已经是 current 的（重启）保留原切换时间
        currentSince: sql`case when ${deployReleases.isCurrent} then coalesce(${deployReleases.currentSince}, now()) else now() end`,
        removedAt: null,
        ...(result.sizeBytes !== null ? { sizeBytes: result.sizeBytes } : {}),
        ...(run.kind === 'deploy' ? { runId: run.id, appReleaseId: run.appReleaseId, artifactId: run.artifactId } : {}),
      },
    });
    if (result.prunedReleaseNames.length > 0) {
      await tx.update(deployReleases).set({ removedAt: new Date(), isCurrent: false })
        .where(and(eq(deployReleases.targetId, run.targetId), eq(deployReleases.hostId, hostId), inArray(deployReleases.releaseName, result.prunedReleaseNames)));
    }
  });
}

/** 部署在解包之后失败（含自动回滚）：release 目录已在主机上，登记为非 current 的还原点，避免登记表与主机脱节 */
async function recordFailedRelease(rc: RunContext, hostId: number, sizeBytes: number | null = null) {
  const { run } = rc;
  if (run.kind !== 'deploy' || !run.releaseName) return;
  await db.insert(deployReleases).values({
    appId: run.appId,
    targetId: run.targetId,
    hostId,
    releaseName: run.releaseName,
    version: run.version ?? versionFromReleaseName(run.releaseName) ?? 'unknown',
    appReleaseId: run.appReleaseId,
    artifactId: run.artifactId,
    runId: run.id,
    isCurrent: false,
    sizeBytes,
    removedAt: null,
  }).onConflictDoNothing({ target: [deployReleases.targetId, deployReleases.hostId, deployReleases.releaseName] });
}

/** 解包完成之后的步骤：失败时 release 目录已存在于主机 */
const STEPS_AFTER_UNPACK: ReadonlySet<DeployStep> = new Set<DeployStep>(['before_switch', 'switch', 'restart', 'health_check', 'prune']);

async function runOneHost(rc: RunContext, hostRow: DeployRunHostRow, artifact: PipelineArtifact | undefined): Promise<DeployHostStatus> {
  const { run, hostNames } = rc;
  const hostId = hostRow.hostId;
  const hostName = hostNames.get(hostId) ?? `主机 #${hostId}`;
  const startedAt = new Date();
  await setHostState(rc, hostId, { status: 'running', step: null, startedAt, finishedAt: null, error: null }, 'running');
  await appendLog(rc, hostId, 'info', null, `▶ ${hostName}：开始${DEPLOY_RUN_KIND_LABELS[run.kind]}${hostRow.status === 'running' ? '（上次执行被中断，重新执行）' : ''}`);

  let executor: RemoteHostExecutor;
  try {
    executor = await getRemoteExecutor(hostId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await appendLog(rc, hostId, 'error', 'preflight', `无法连接主机：${message}`);
    await setHostState(rc, hostId, { status: 'failed', step: 'preflight', finishedAt: new Date(), error: message }, 'failed');
    return 'failed';
  }

  try {
    const result = await runHostPipeline({
      kind: run.kind,
      executor,
      snapshot: run.snapshot,
      releaseName: run.releaseName,
      version: run.version,
      appKey: rc.appKey,
      artifact,
      log: (level, step, line) => appendLog(rc, hostId, level, step, line),
      onStep: (step) => setHostState(rc, hostId, { step }),
      isCancelled: () => isRunCancelled(rc),
    });
    // 主机上已经切好版本；登记表更新失败不改写部署结论，留给「对账」修正
    await recordHostRelease(rc, hostId, result).catch(async (err) => {
      await appendLog(rc, hostId, 'warn', null, `发布目录登记失败（主机上部署已生效，可用「对账」修正）：${err instanceof Error ? err.message : String(err)}`);
    });
    const effectiveRelease = run.kind === 'restart' ? result.previousReleaseName : run.releaseName;
    await setHostState(rc, hostId, {
      status: 'succeeded',
      releaseName: effectiveRelease,
      previousReleaseName: run.kind === 'restart' ? null : result.previousReleaseName,
      finishedAt: new Date(),
    }, 'succeeded');
    await appendLog(rc, hostId, 'info', null, `✔ ${hostName}：${DEPLOY_RUN_KIND_LABELS[run.kind]}成功（${((Date.now() - startedAt.getTime()) / 1000).toFixed(1)}s）`);
    return 'succeeded';
  } catch (err) {
    if (err instanceof DeployCancelledError) {
      await appendLog(rc, hostId, 'warn', null, `■ ${hostName}：已取消（未切换版本）`);
      await setHostState(rc, hostId, { status: 'cancelled', finishedAt: new Date(), error: '已取消' }, 'cancelled');
      return 'cancelled';
    }
    const stepErr = err instanceof DeployStepError ? err : null;
    const message = stepErr?.message ?? (err instanceof Error ? err.message : String(err));
    const status: DeployHostStatus = stepErr?.rolledBack ? 'rolled_back' : 'failed';
    if (!stepErr) await appendLog(rc, hostId, 'error', null, message);
    if (stepErr && STEPS_AFTER_UNPACK.has(stepErr.step)) await recordFailedRelease(rc, hostId).catch(() => {});
    await setHostState(rc, hostId, {
      status,
      step: stepErr?.step ?? null,
      releaseName: run.releaseName,
      previousReleaseName: stepErr?.previousReleaseName ?? null,
      finishedAt: new Date(),
      error: message,
    }, status);
    await appendLog(rc, hostId, 'error', null, `✖ ${hostName}：${stepErr ? `${DEPLOY_STEP_LABELS[stepErr.step]}失败` : '失败'}${status === 'rolled_back' ? '，已自动回滚' : ''}`);
    return status;
  }
}

function aggregateStatus(rc: RunContext, statuses: DeployHostStatus[]): DeployRunStatus {
  const succeeded = statuses.filter((s) => s === 'succeeded').length;
  const failed = statuses.filter((s) => s === 'failed' || s === 'rolled_back').length;
  if (succeeded === statuses.length) return 'succeeded';
  if (rc.cancelRequested && failed === 0) return 'cancelled';
  if (succeeded === 0) return 'failed';
  return 'partial';
}

async function notifyFinished(rc: RunContext, status: DeployRunStatus, summary: string) {
  if (!rc.run.createdBy) return;
  const version = rc.run.version ?? rc.run.releaseName ?? '';
  await notify('ops.deploy.finished', {
    recipients: [{ type: 'user', id: rc.run.createdBy }],
    vars: {
      appName: rc.appName,
      targetName: rc.target.name,
      kindLabel: DEPLOY_RUN_KIND_LABELS[rc.run.kind],
      version,
      // 重启没有版本号：主语退化为应用名，避免模板里出现空洞
      subject: version ? `${rc.appName} ${version}` : `${rc.appName}${DEPLOY_RUN_KIND_LABELS[rc.run.kind]}`,
      statusLabel: DEPLOY_RUN_STATUS_LABELS[status],
      summary,
    },
    link: `/system/deploy?tab=runs&run=${rc.run.id}`,
    dedupeKey: `deploy-run-finished:${rc.run.id}`,
  }).catch((err) => logger.warn(`[deploy] run #${rc.run.id} 结束通知发送失败`, err));
}

async function executeDeployRun(ctx: TaskRunContext): Promise<Record<string, unknown>> {
  const runId = Number(ctx.payload.runId);
  const [claimed] = await db.update(deployRuns)
    .set({ status: 'running', startedAt: sql`coalesce(${deployRuns.startedAt}, now())` })
    .where(and(eq(deployRuns.id, runId), inArray(deployRuns.status, ['pending', 'running'])))
    .returning();
  if (!claimed) {
    logger.warn(`[deploy] run #${runId} 不在可执行状态，跳过`);
    return { runId, skipped: true };
  }
  const [meta] = await db
    .select({ target: deployTargets, appKey: clientApps.appKey, appName: clientApps.name })
    .from(deployTargets)
    .innerJoin(clientApps, eq(clientApps.id, deployTargets.appId))
    .where(eq(deployTargets.id, claimed.targetId))
    .limit(1);
  if (!meta) throw new Error('部署目标已被删除');
  const [{ maxSeq }] = await db.select({ maxSeq: max(deployRunLogs.seq) }).from(deployRunLogs).where(eq(deployRunLogs.runId, runId));
  const hostRows = await db
    .select({ host: deployRunHosts, hostName: opsHosts.name })
    .from(deployRunHosts)
    .innerJoin(opsHosts, eq(opsHosts.id, deployRunHosts.hostId))
    .where(eq(deployRunHosts.runId, runId))
    .orderBy(asc(deployRunHosts.id));

  const rc: RunContext = {
    run: claimed,
    target: meta.target,
    appKey: meta.appKey,
    appName: meta.appName,
    hostNames: new Map(hostRows.map((h) => [h.host.hostId, h.hostName])),
    ctx,
    cancelRequested: false,
    takenOver: false,
    seq: maxSeq ?? 0,
    pendingLogs: [],
  };

  // 心跳 + 取消探测：上传 / 钩子可能持续数分钟，必须独立于步骤节奏续心跳
  let done = 0;
  const total = hostRows.length;
  const heartbeat = async () => {
    const { cancelRequested } = await ctx.progress({ processed: done, total });
    if (cancelRequested) await markCancelled(rc);
  };
  const heartbeatTimer = setInterval(() => { void heartbeat().catch(() => {}); }, HEARTBEAT_INTERVAL_MS);
  const logTimer = setInterval(() => flushLogs(rc), LOG_PUSH_INTERVAL_MS);

  try {
    await heartbeat();
    pushRunUpdate(rc, 'running');
    if (ctx.attempt > 1) await appendLog(rc, null, 'warn', null, `任务第 ${ctx.attempt} 次执行：已成功的主机跳过，其余主机重新执行`);
    else await appendLog(rc, null, 'info', null, `开始${DEPLOY_RUN_KIND_LABELS[claimed.kind]}：${meta.appName} ${claimed.version ?? claimed.releaseName ?? ''} → ${meta.target.name}，${total} 台主机，${claimed.snapshot.strategy === 'parallel' ? `并行（最多 ${claimed.snapshot.maxParallel} 台）` : '滚动'}`);

    let artifact: PipelineArtifact | undefined;
    if (claimed.kind === 'deploy') {
      const [art] = claimed.artifactId ? await db.select().from(appArtifacts).where(eq(appArtifacts.id, claimed.artifactId)).limit(1) : [];
      if (!art?.fileId) throw new Error('制品或其文件已被删除，无法部署');
      artifact = buildArtifact(rc, art);
      await appendLog(rc, null, 'info', null, `制品：${art.fileName}（${(art.size / 1024 / 1024).toFixed(1)} MB${art.sha256 ? `，sha256 ${art.sha256.slice(0, 12)}…` : ''}），release ${claimed.releaseName}`);
    }

    const statuses = new Map<number, DeployHostStatus>();
    let stop = false;
    const finishHost = async (hostId: number, status: DeployHostStatus) => {
      statuses.set(hostId, status);
      done += 1;
      if ((status === 'failed' || status === 'rolled_back') && claimed.snapshot.stopOnFailure) stop = true;
      await ctx.reportItems([{
        key: String(hostId),
        label: rc.hostNames.get(hostId) ?? String(hostId),
        status: status === 'succeeded' ? 'success' : status === 'skipped' || status === 'cancelled' ? 'skipped' : 'failed',
        message: status === 'succeeded' ? null : DEPLOY_RUN_KIND_LABELS[claimed.kind] + (status === 'rolled_back' ? '失败，已自动回滚' : status === 'skipped' ? '因前序失败跳过' : status === 'cancelled' ? '已取消' : '失败'),
      }]);
      await ctx.progress({ processed: done, total, failed: [...statuses.values()].filter((s) => s === 'failed' || s === 'rolled_back').length });
    };
    const processHost = async (row: { host: DeployRunHostRow; hostName: string }) => {
      if (row.host.status === 'succeeded') {
        statuses.set(row.host.hostId, 'succeeded');
        done += 1;
        return;
      }
      if (rc.takenOver) return;
      if (stop || await isRunCancelled(rc)) {
        const status: DeployHostStatus = rc.cancelRequested ? 'cancelled' : 'skipped';
        await setHostState(rc, row.host.hostId, { status, finishedAt: new Date(), error: status === 'skipped' ? '因前序主机失败跳过' : '已取消' }, status);
        await appendLog(rc, row.host.hostId, 'warn', null, `○ ${row.hostName}：${status === 'skipped' ? '因前序主机失败跳过' : '已取消'}`);
        await finishHost(row.host.hostId, status);
        return;
      }
      const status = await runOneHost(rc, row.host, artifact);
      await finishHost(row.host.hostId, status);
    };

    if (claimed.snapshot.strategy === 'parallel') {
      await mapWithConcurrency(hostRows, claimed.snapshot.maxParallel, processHost);
    } else {
      for (const row of hostRows) await processHost(row);
    }

    if (rc.takenOver) {
      flushLogs(rc);
      return { runId, takenOver: true };
    }

    const all = hostRows.map((h) => statuses.get(h.host.hostId) ?? 'pending');
    const status = aggregateStatus(rc, all);
    const succeeded = all.filter((s) => s === 'succeeded').length;
    const failed = all.filter((s) => s === 'failed' || s === 'rolled_back').length;
    const summary = `${succeeded}/${total} 台成功${failed ? `，${failed} 台失败` : ''}${all.includes('skipped') ? `，${all.filter((s) => s === 'skipped').length} 台跳过` : ''}${all.includes('cancelled') ? `，${all.filter((s) => s === 'cancelled').length} 台取消` : ''}`;
    await appendLog(rc, null, status === 'succeeded' ? 'info' : status === 'partial' ? 'warn' : 'error', null, `${DEPLOY_RUN_KIND_LABELS[claimed.kind]}${DEPLOY_RUN_STATUS_LABELS[status]}：${summary}`);
    await db.transaction((tx) => finalizeRunRow(tx, runId, status, null));
    flushLogs(rc);
    pushRunUpdate(rc, status);
    await notifyFinished(rc, status, summary);
    return { runId, status, hostSucceeded: succeeded, hostFailed: failed };
  } catch (err) {
    // 主机之外的整体失败（制品缺失 / 目标被删）
    const message = err instanceof Error ? err.message : String(err);
    await appendLog(rc, null, 'error', null, `部署中止：${message}`).catch(() => {});
    await db.transaction(async (tx) => {
      await tx.update(deployRunHosts).set({ status: 'failed', finishedAt: new Date(), error: message })
        .where(and(eq(deployRunHosts.runId, runId), inArray(deployRunHosts.status, ['pending', 'running'])));
      await finalizeRunRow(tx, runId, 'failed', message);
    });
    flushLogs(rc);
    pushRunUpdate(rc, 'failed');
    await notifyFinished(rc, 'failed', message);
    throw err;
  } finally {
    clearInterval(heartbeatTimer);
    clearInterval(logTimer);
    flushLogs(rc);
  }
}

export function registerDeployTaskHandlers(): void {
  registerTaskHandler({
    taskType: DEPLOY_RUN_TASK_TYPE,
    title: '应用部署',
    module: '应用部署',
    description: '把应用版本的部署包推送到目标主机并切换版本（含回滚 / 重启）；同一目标同时只跑一个',
    allowConcurrent: true,
    maxAttempts: 1,
    affinity: 'any',
    run: executeDeployRun,
  });
}

// ─── 对账 / 删除 release ──────────────────────────────────────────────────────

/** 逐台读取 current 与 releases/，把登记表校正到与主机一致 */
export async function syncDeployTarget(id: number): Promise<DeployTargetSyncResult> {
  const target = await ensureDeployTargetExists(id);
  const hosts = await resolveTargetHosts(id);
  const results: DeployTargetSyncResult['hosts'] = [];
  for (const host of hosts) {
    try {
      const executor = await getRemoteExecutor(host.hostId);
      const { current, releases } = await inspectHostReleases(executor, target.deployPath);
      const known = await db.select().from(deployReleases).where(and(eq(deployReleases.targetId, id), eq(deployReleases.hostId, host.hostId)));
      const knownByName = new Map(known.map((r) => [r.releaseName, r]));
      const onHost = new Set(releases);
      let discovered = 0;
      let missing = 0;
      await db.transaction(async (tx) => {
        for (const name of releases) {
          const row = knownByName.get(name);
          if (!row) {
            await tx.insert(deployReleases).values({
              appId: target.appId, targetId: id, hostId: host.hostId, releaseName: name,
              version: versionFromReleaseName(name) ?? 'unknown', isCurrent: false, removedAt: null,
            });
            discovered += 1;
          } else if (row.removedAt) {
            await tx.update(deployReleases).set({ removedAt: null }).where(eq(deployReleases.id, row.id));
            discovered += 1;
          }
        }
        for (const row of known) {
          if (!row.removedAt && !onHost.has(row.releaseName)) {
            await tx.update(deployReleases).set({ removedAt: new Date(), isCurrent: false }).where(eq(deployReleases.id, row.id));
            missing += 1;
          }
        }
        await tx.update(deployReleases).set({ isCurrent: false })
          .where(and(eq(deployReleases.targetId, id), eq(deployReleases.hostId, host.hostId), eq(deployReleases.isCurrent, true), current ? ne(deployReleases.releaseName, current) : sql`true`));
        if (current) {
          await tx.update(deployReleases).set({ isCurrent: true, currentSince: new Date() })
            .where(and(eq(deployReleases.targetId, id), eq(deployReleases.hostId, host.hostId), eq(deployReleases.releaseName, current), eq(deployReleases.isCurrent, false)));
        }
      });
      results.push({ hostId: host.hostId, hostName: host.hostName, ok: true, message: null, currentReleaseName: current, discovered, missing });
    } catch (err) {
      results.push({ hostId: host.hostId, hostName: host.hostName, ok: false, message: err instanceof Error ? err.message : String(err), currentReleaseName: null, discovered: 0, missing: 0 });
    }
  }
  return { target: await getDeployTarget(id), hosts: results };
}

/** 删除主机上的 release 目录并标记登记行；current 与进行中 run 的目标 release 不可删 */
export async function deleteDeployRelease(id: number): Promise<void> {
  const [row] = await db.select().from(deployReleases).where(eq(deployReleases.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: 'release 不存在' });
  if (row.isCurrent) throw new HTTPException(400, { message: '当前运行版本不能删除，请先回滚 / 部署到其他版本' });
  const active = await db.$count(deployRuns, and(eq(deployRuns.targetId, row.targetId), inArray(deployRuns.status, ['pending', 'running'])));
  if (active > 0) throw new HTTPException(400, { message: '该目标有进行中的部署，请稍后再删' });
  if (!row.removedAt) {
    const target = await ensureDeployTargetExists(row.targetId);
    const executor = await getRemoteExecutor(row.hostId);
    await removeHostRelease(executor, target.deployPath, row.releaseName);
  }
  await db.update(deployReleases).set({ removedAt: row.removedAt ?? new Date() }).where(eq(deployReleases.id, id));
  logger.info(`[deploy] 用户 #${currentUser().userId} 删除 release ${row.releaseName}（target #${row.targetId}, host #${row.hostId}）`);
}

export async function getDeployReleaseBeforeAudit(id: number) {
  const [row] = await db.select().from(deployReleases).where(eq(deployReleases.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: 'release 不存在' });
  return row;
}
