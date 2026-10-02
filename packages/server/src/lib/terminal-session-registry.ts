/**
 * Web 终端会话注册表（进程内单例）
 *
 * 维护所有活动终端会话（本地 PTY / SSH / Docker exec）的运行态，供三方消费：
 *  - ws-terminal 路由：注册 / 附接 I/O、断线保活、销毁
 *  - ws-terminal-monitor 路由：管理员实时旁观（observer）与接管输入
 *  - terminal-sessions 服务：列出活动会话、强制终止、落库结算
 *
 * 授权模型：会话句柄**只能**通过 `registerSession`（新建）或
 * `acquireOwnedSession`（校验归属）取得。历史实现导出过按任意 ID 取会话的
 * `getSession`，于是每个新增 handler 都必须自行记得比对 userId，漏一个即越权。
 * 现在「拿到别人的会话」在 API 层面无法表达；监控路径确需绕过归属校验时，
 * 必须显式走 `findSessionForAuthorizedCaller`，其命名与文档要求调用方先完成租户判定。
 *
 * 进程只存活在本 Node 实例内存中；`NODE_ID` 让持久化记录能定位承载实例，
 * 并在实例重启后结算残留记录。
 */

import os from 'node:os';
import type { TerminalEndReason, TerminalSessionKind } from '@arcbase/shared/ops';
import { config } from '../config';

/** 抽象终端进程接口，兼容本地 PTY 和 SSH 两种后端 */
export interface TerminalProcess {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  /** 本地 PTY 的进程号，用于连带清理整个进程组；SSH / 远端进程为 undefined */
  readonly pid?: number;
}

/** 客户端连接（终端使用者） */
export interface ClientConn {
  send: (data: string) => void;
  close: (code: number, reason: string) => void;
}

/** 观察者连接（管理员监控端） */
export interface ObserverConn {
  send: (data: string) => void;
}

export type TerminalKind = TerminalSessionKind;

export interface TerminalSession {
  /** 服务端生成的会话标识（UUIDv7） */
  readonly sessionId: string;
  process: TerminalProcess;
  /** 当前连接的客户端 WebSocket（无连接时为 null） */
  currentWs: ClientConn | null;
  /** 近期输出缓冲，断线重连 / 监控接入后回放 */
  outputBuffer: string;
  /** 进程保活计时器 */
  idleTimer: ReturnType<typeof setTimeout> | null;
  /** 会话归属用户，防止越权重连 */
  readonly userId: number;
  readonly username: string;
  /** 会话归属租户，监控 / 接管 / 终止均按此隔离 */
  readonly tenantId: number | null;
  readonly kind: TerminalKind;
  /** 连接目标：本地 shell id / ssh:<profileId> / host:<opsHostId> / docker-exec:* / db-psql */
  readonly target: string;
  /** 展示标签：本地为 shell 名，SSH 为 user@host，Docker 为容器名 */
  label: string;
  readonly clientIp: string;
  readonly startedAt: number;
  lastActivityAt: number;
  cols: number;
  rows: number;
  /** 管理员实时监控连接集合 */
  observers: Set<ObserverConn>;
  /** 正在接管输入的管理员用户 ID（null 表示无人接管） */
  takenOverBy: number | null;
}

/** PTY 会话的输出缓冲区上限（字节） */
export const OUTPUT_BUFFER_MAX = 50 * 1024;

/** 承载会话进程的服务实例标识；持久化记录据此定位与结算 */
export const NODE_ID = `${os.hostname()}:${config.port}`;

const sessions = new Map<string, TerminalSession>();

/** 会话生命周期回调，由 service 层注入以完成落库，避免 registry 依赖数据库 */
export interface SessionLifecycleHooks {
  onEnded?: (session: TerminalSession, reason: TerminalEndReason) => void;
  onDetached?: (session: TerminalSession) => void;
  onReattached?: (session: TerminalSession) => void;
}

let hooks: SessionLifecycleHooks = {};

export function setSessionLifecycleHooks(next: SessionLifecycleHooks): void {
  hooks = next;
}

export interface RegisterSessionInput {
  sessionId: string;
  process: TerminalProcess;
  currentWs: ClientConn;
  userId: number;
  username: string;
  tenantId: number | null;
  kind: TerminalKind;
  target?: string;
  label: string;
  clientIp: string;
}

/**
 * 登记新会话。ID 由 service 层生成并已落库，此处只建立内存映射。
 * ID 已被占用时返回 null：覆盖登记会让原会话的 PTY 脱离注册表且永不回收。
 */
export function registerSession(input: RegisterSessionInput): TerminalSession | null {
  if (sessions.has(input.sessionId)) return null;
  const now = Date.now();
  const session: TerminalSession = {
    sessionId: input.sessionId,
    process: input.process,
    currentWs: input.currentWs,
    outputBuffer: '',
    idleTimer: null,
    userId: input.userId,
    username: input.username,
    tenantId: input.tenantId,
    kind: input.kind,
    target: input.target ?? '',
    label: input.label,
    clientIp: input.clientIp,
    startedAt: now,
    lastActivityAt: now,
    cols: 80,
    rows: 24,
    observers: new Set(),
    takenOverBy: null,
  };
  sessions.set(input.sessionId, session);
  return session;
}

/**
 * 按归属取得会话句柄；归属不符一律返回 null。
 *
 * 这是使用者侧获取句柄的唯一入口——调用方拿不到别人的会话，
 * 因此后续新增的消息 handler 无需（也无法）自行重复判定归属。
 */
export function acquireOwnedSession(sessionId: string, userId: number): TerminalSession | null {
  const session = sessions.get(sessionId);
  if (!session || session.userId !== userId) return null;
  return session;
}

/**
 * 绕过归属校验按 ID 取会话，**仅供已完成租户 / 权限判定的 service 层调用**
 * （监控与强制终止路径）。业务代码请使用 `acquireOwnedSession`。
 */
export function findSessionForAuthorizedCaller(sessionId: string): TerminalSession | undefined {
  return sessions.get(sessionId);
}

export function clearIdleTimer(session: TerminalSession): void {
  if (session.idleTimer !== null) {
    clearTimeout(session.idleTimer);
    session.idleTimer = null;
  }
}

/** 向所有观察者广播一条 JSON 消息 */
function broadcastToObservers(session: TerminalSession, message: unknown): void {
  if (session.observers.size === 0) return;
  const text = JSON.stringify(message);
  for (const obs of session.observers) {
    try { obs.send(text); } catch { /* ignore broken observer */ }
  }
}

/** 追加输出到缓冲区，并镜像给所有观察者 */
export function appendOutput(session: TerminalSession, data: string): void {
  session.outputBuffer += data;
  if (session.outputBuffer.length > OUTPUT_BUFFER_MAX) {
    session.outputBuffer = session.outputBuffer.slice(-OUTPUT_BUFFER_MAX);
  }
  session.lastActivityAt = Date.now();
  broadcastToObservers(session, { type: 'terminal:output', data });
}

/** 记录一次输入活动（更新最近活跃时间） */
export function touchActivity(session: TerminalSession): void {
  session.lastActivityAt = Date.now();
}

/** 更新会话终端尺寸 */
export function setSize(session: TerminalSession, cols: number, rows: number): void {
  session.cols = cols;
  session.rows = rows;
}

/**
 * 断开客户端连接但保留进程，等待重连。
 *
 * 仅当 `ws` 仍是会话当前连接时生效——会话被新连接接管后，
 * 旧连接的关闭事件不得掐断存活会话。
 */
export function detachClient(session: TerminalSession, ws: ClientConn, idleTimeoutMs: number): void {
  if (session.currentWs !== ws) return;
  session.currentWs = null;
  session.idleTimer = setTimeout(() => {
    endSession(session.sessionId, 'idle_timeout');
  }, idleTimeoutMs);
  hooks.onDetached?.(session);
}

/** 客户端重新接入已有会话 */
export function reattachClient(session: TerminalSession, ws: ClientConn): void {
  clearIdleTimer(session);
  session.currentWs = ws;
  session.lastActivityAt = Date.now();
  hooks.onReattached?.(session);
}

/**
 * 杀死终端进程及其子进程。
 *
 * `pty.kill()` 只终止 shell 自身，通过 setsid 脱离的子进程会残留；
 * POSIX 下补一次进程组信号，把整组一并回收。
 */
function killProcessTree(target: TerminalProcess): void {
  try { target.kill(); } catch { /* ignore */ }
  const { pid } = target;
  if (pid === undefined || os.platform() === 'win32') return;
  try { process.kill(-pid, 'SIGKILL'); } catch { /* 进程组已消失 */ }
}

/** 结束会话：杀进程组、清计时器、通知观察者、移除登记并结算记录 */
export function endSession(sessionId: string, reason: TerminalEndReason): void {
  const s = sessions.get(sessionId);
  if (!s) return;
  clearIdleTimer(s);
  sessions.delete(sessionId);
  broadcastToObservers(s, { type: 'terminal:ended' });
  killProcessTree(s.process);
  hooks.onEnded?.(s, reason);
}

// ─── 监控 / 接管 API ────────────────────────────────────────────────────────

/** 附加一个观察者，返回当前输出缓冲用于回放 */
export function attachObserver(session: TerminalSession, observer: ObserverConn): string {
  session.observers.add(observer);
  return session.outputBuffer;
}

/** 移除一个观察者 */
export function detachObserver(session: TerminalSession, observer: ObserverConn): void {
  session.observers.delete(observer);
  if (session.takenOverBy !== null && session.observers.size === 0) {
    session.takenOverBy = null;
  }
}

/** 管理员向会话注入输入（接管）。返回是否成功。 */
export function writeToSession(session: TerminalSession, data: string, adminUserId: number): boolean {
  session.takenOverBy = adminUserId;
  session.lastActivityAt = Date.now();
  try {
    session.process.write(data);
    return true;
  } catch {
    return false;
  }
}

/** 强制终止会话：通知客户端与观察者后结束。 */
export function terminateSession(session: TerminalSession): void {
  try {
    session.currentWs?.send(JSON.stringify({ type: 'terminal:terminated', message: '会话已被管理员强制终止' }));
    session.currentWs?.close(1000, '管理员强制终止');
  } catch { /* ignore */ }
  endSession(session.sessionId, 'terminated_by_admin');
}

export interface TerminalSessionMeta {
  sessionId: string;
  userId: number;
  username: string;
  tenantId: number | null;
  kind: TerminalKind;
  label: string;
  clientIp: string;
  startedAt: number;
  lastActivityAt: number;
  cols: number;
  rows: number;
  connected: boolean;
  observerCount: number;
  takenOver: boolean;
}

function toMeta(s: TerminalSession): TerminalSessionMeta {
  return {
    sessionId: s.sessionId,
    userId: s.userId,
    username: s.username,
    tenantId: s.tenantId,
    kind: s.kind,
    label: s.label,
    clientIp: s.clientIp,
    startedAt: s.startedAt,
    lastActivityAt: s.lastActivityAt,
    cols: s.cols,
    rows: s.rows,
    connected: s.currentWs !== null,
    observerCount: s.observers.size,
    takenOver: s.takenOverBy !== null,
  };
}

export function toSessionMeta(session: TerminalSession): TerminalSessionMeta {
  return toMeta(session);
}

/** 列出全部活动会话的元数据（按开始时间倒序） */
export function listSessionsMeta(): TerminalSessionMeta[] {
  return [...sessions.values()].map(toMeta).sort((a, b) => b.startedAt - a.startedAt);
}

/** 指定用户当前持有的活动会话数，用于配额判定 */
export function countSessionsByUser(userId: number): number {
  let count = 0;
  for (const s of sessions.values()) {
    if (s.userId === userId) count += 1;
  }
  return count;
}

/** 快照全部活动会话，供周期性落库使用 */
export function snapshotSessions(): TerminalSession[] {
  return [...sessions.values()];
}

/** 停机时结束全部会话，确保不留下孤儿进程与"永远 active"的记录 */
export function endAllSessions(reason: TerminalEndReason): void {
  for (const sessionId of [...sessions.keys()]) {
    endSession(sessionId, reason);
  }
}

/** 结束指定连接目标的全部会话（主机配置变更 / 删除时避免旧凭据会话继续存活）。 */
export function endSessionsByTarget(target: string, reason: TerminalEndReason): void {
  for (const session of [...sessions.values()]) {
    if (session.target === target) endSession(session.sessionId, reason);
  }
}
