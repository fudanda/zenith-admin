/**
 * 单台主机的部署流水线（应用部署引擎的核心，不碰数据库）。
 *
 * 主机布局（`deployPath` 下）：
 *   releases/<yyyyMMddHHmmss-version>/   每次部署一个不可变目录
 *   shared/                               跨版本持久化（logs / config …），软链进每个 release
 *   current -> releases/<x>               唯一可变点，`ln -sfn` + `mv -T` 原子替换
 *   tmp/                                  制品落地 + sha256 校验
 *
 * 步骤：preflight → upload → unpack → before_switch → switch → restart → health_check → prune。
 * 回滚 run 从 switch 开始（release 已在主机上），重启 run 只走 restart + health_check。
 * switch 之后任一步失败且 autoRollback 开启，切回上一版并重启（结果 rolledBack = true）。
 *
 * 安全边界：所有命令 argv 数组经 host-exec 单引号编码，不拼接 shell 字符串；自定义脚本经
 * `bash -c 'cd -- "$1" && shift && exec "$@"' … env K=V bash -c <script>` 在 release 目录内执行，脚本文本本身也是一个 argv；
 * `rm -rf` 只作用于 releases/ 下且名字符合 DEPLOY_RELEASE_NAME_RE 的目录。
 */
import { createHash } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DEPLOY_RELEASE_NAME_RE, type DeployLogLevel, type DeployRunKind, type DeployRunSnapshot, type DeployStep } from '@arcbase/shared/ops';
import { HostExecError, type ExecResult, type RemoteHostExecutor } from '../../lib/host-exec';

// ─── 输入 / 输出 ─────────────────────────────────────────────────────────────

export interface PipelineArtifact {
  fileName: string;
  size: number;
  sha256: string | null;
  /** 打开制品内容流（每次调用新开一个；上传失败重试时会再次调用） */
  open(): Promise<ReadableStream<Uint8Array>>;
}

export interface PipelineLogger {
  (level: DeployLogLevel, step: DeployStep | null, line: string): void | Promise<void>;
}

export interface HostPipelineInput {
  kind: DeployRunKind;
  executor: RemoteHostExecutor;
  snapshot: DeployRunSnapshot;
  /** deploy = 本次新建的 release 名；rollback = 要切回的 release 名；restart 可为空 */
  releaseName: string | null;
  version: string | null;
  appKey: string;
  artifact?: PipelineArtifact;
  log: PipelineLogger;
  /** 进入某步骤时回调（持久化当前步骤） */
  onStep?: (step: DeployStep) => void | Promise<void>;
  /** 协作式取消：每步开始前询问；已切换的版本不回退 */
  isCancelled?: () => Promise<boolean> | boolean;
  /** 时间来源（测试注入） */
  now?: () => Date;
}

export interface HostPipelineResult {
  /** 切换前的 current（restart 时即当前版本） */
  previousReleaseName: string | null;
  /** 健康检查 / 重启失败后已自动切回上一版 */
  rolledBack: boolean;
  /** 新 release 目录大小（deploy 成功时） */
  sizeBytes: number | null;
  /** 按保留策略清理掉的 release 名 */
  prunedReleaseNames: string[];
  /** 制品上传因 tmp/ 已有同 sha256 文件而跳过 */
  uploadSkipped: boolean;
}

export class DeployCancelledError extends Error {
  constructor() {
    super('已请求取消');
    this.name = 'DeployCancelledError';
  }
}

/** 某步骤失败；`rolledBack` 表示已自动回滚成功 */
export class DeployStepError extends Error {
  constructor(readonly step: DeployStep, message: string, readonly rolledBack = false, readonly previousReleaseName: string | null = null) {
    super(message);
    this.name = 'DeployStepError';
  }
}

// ─── 工具 ────────────────────────────────────────────────────────────────────

const STEP_TIMEOUT_MS = {
  quick: 30_000,
  unpack: 10 * 60_000,
  hook: 15 * 60_000,
  restart: 5 * 60_000,
  prune: 5 * 60_000,
} as const;

const RELEASE_ENV_PREFIX = 'ARCBASE_';

export function releaseNameFor(version: string, at: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
  const safeVersion = version.replaceAll(/[^A-Za-z0-9._-]/g, '-').slice(0, 64);
  const name = `${stamp}-${safeVersion}`;
  if (!DEPLOY_RELEASE_NAME_RE.test(name)) throw new Error(`release 名不合法：${name}`);
  return name;
}

/** 从 release 名解析版本号（14 位时间戳 + '-' 之后） */
export function versionFromReleaseName(name: string): string | null {
  return DEPLOY_RELEASE_NAME_RE.test(name) ? name.slice(15) : null;
}

function errorText(err: unknown): string {
  if (err instanceof HostExecError) {
    const tail = (err.stderr || err.stdout).trim().split('\n').slice(-3).join(' | ');
    return tail ? `${err.message}${err.message.includes(tail) ? '' : `（${tail.slice(0, 300)}）`}` : err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

function archiveKind(fileName: string): 'tar.gz' | 'tar' | 'zip' | 'file' {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'tar.gz';
  if (lower.endsWith('.tar')) return 'tar';
  if (lower.endsWith('.zip')) return 'zip';
  return 'file';
}

export interface HostLayout {
  root: string;
  releases: string;
  shared: string;
  current: string;
  tmp: string;
  release: (name: string) => string;
}

export function layoutOf(deployPath: string): HostLayout {
  const root = deployPath.replace(/\/+$/, '');
  return {
    root,
    releases: `${root}/releases`,
    shared: `${root}/shared`,
    current: `${root}/current`,
    tmp: `${root}/tmp`,
    release: (name: string) => {
      if (!DEPLOY_RELEASE_NAME_RE.test(name)) throw new Error(`release 名不合法：${name}`);
      return `${root}/releases/${name}`;
    },
  };
}

/** 只在这些步骤入口响应取消：switch 之后（重启 / 健康检查 / 清理）是不可打断的整体，避免主机停在「已切换未重启」或把已生效的部署记成取消 */
const CANCEL_SAFE_STEPS: ReadonlySet<DeployStep> = new Set<DeployStep>(['preflight', 'upload', 'unpack', 'before_switch', 'switch']);

/** 一次流水线执行中所有远端调用的封装：统一超时 / 日志 / 取消检查 */
class HostSession {
  constructor(readonly input: HostPipelineInput, readonly layout: HostLayout) {}

  get exec() {
    return this.input.executor;
  }

  log(level: DeployLogLevel, step: DeployStep | null, line: string) {
    return this.input.log(level, step, line);
  }

  async checkCancelled() {
    if (await this.input.isCancelled?.()) throw new DeployCancelledError();
  }

  async step(step: DeployStep) {
    if (CANCEL_SAFE_STEPS.has(step)) await this.checkCancelled();
    await this.input.onStep?.(step);
  }

  run(file: string, args: readonly string[], timeoutMs: number = STEP_TIMEOUT_MS.quick): Promise<ExecResult> {
    return this.exec.exec(file, args, { timeoutMs, maxBuffer: 8 * 1024 * 1024 });
  }

  /** 命令存在性 / 可选检查：失败返回 null 而不是抛错 */
  async tryRun(file: string, args: readonly string[], timeoutMs?: number): Promise<ExecResult | null> {
    try {
      return await this.run(file, args, timeoutMs);
    } catch {
      return null;
    }
  }

  /** 传给钩子 / 重启脚本 / 健康检查命令的环境变量（目标 env 之上叠加部署上下文） */
  envPairs(releaseName: string | null, previousReleaseName: string | null): string[] {
    const { snapshot, appKey, version } = this.input;
    const ctx: Record<string, string> = {
      [`${RELEASE_ENV_PREFIX}APP_KEY`]: appKey,
      [`${RELEASE_ENV_PREFIX}VERSION`]: version ?? '',
      [`${RELEASE_ENV_PREFIX}RELEASE_NAME`]: releaseName ?? '',
      [`${RELEASE_ENV_PREFIX}RELEASE_PATH`]: releaseName ? this.layout.release(releaseName) : this.layout.current,
      [`${RELEASE_ENV_PREFIX}CURRENT_PATH`]: this.layout.current,
      [`${RELEASE_ENV_PREFIX}DEPLOY_PATH`]: this.layout.root,
      [`${RELEASE_ENV_PREFIX}SHARED_PATH`]: this.layout.shared,
      [`${RELEASE_ENV_PREFIX}PREVIOUS_RELEASE`]: previousReleaseName ?? '',
    };
    return Object.entries({ ...snapshot.env, ...ctx }).map(([k, v]) => `${k}=${v}`);
  }

  /**
   * 在 cwd 内以给定环境执行一段 bash 脚本，逐行回传输出；超时即终止。
   * 脚本文本作为独立 argv 传入，内部 `"$@"` 展开为 `env K=V … bash -c <script>`。
   */
  async runScript(step: DeployStep, cwd: string, script: string, env: string[], timeoutMs: number): Promise<void> {
    const args = ['-c', 'cd -- "$1" && shift && exec "$@"', 'arcbase-deploy', cwd, 'env', ...env, 'bash', '-c', script];
    let buffered = '';
    const flush = (final = false) => {
      const parts = buffered.split('\n');
      buffered = final ? '' : (parts.pop() ?? '');
      for (const part of parts) {
        const line = part.replace(/\r$/, '');
        if (line.trim()) void this.log('info', step, `  ${line}`);
      }
    };
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      let settled = false;
      let handle: { kill: () => void } | null = null;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        handle?.kill();
        reject(new Error(`脚本执行超时（${Math.round(timeoutMs / 1000)}s）`));
      }, timeoutMs);
      this.exec.execStream('bash', args, {
        onData: (chunk) => { buffered += chunk; flush(); },
        onExit: (code) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          flush(true);
          resolve(code);
        },
      }).then((h) => { handle = h; }, (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
    });
    if (exitCode !== 0) throw new Error(`脚本退出码 ${exitCode ?? 'unknown'}`);
  }

  /** current 软链当前指向的 release 名；不存在 / 不指向 releases/ 时为 null */
  async readCurrent(): Promise<string | null> {
    const res = await this.tryRun('readlink', [this.layout.current]);
    if (!res) return null;
    const target = res.stdout.trim();
    const name = target.split('/').filter(Boolean).at(-1) ?? '';
    return DEPLOY_RELEASE_NAME_RE.test(name) ? name : null;
  }

  /** releases/ 下符合命名规则的目录名 */
  async listReleases(): Promise<string[]> {
    const res = await this.tryRun('ls', ['-1', this.layout.releases]);
    if (!res) return [];
    return res.stdout.split('\n').map((s) => s.trim()).filter((s) => DEPLOY_RELEASE_NAME_RE.test(s));
  }

  /**
   * 原子切换：在 releases/ 里先建好临时软链，再 mv 进部署根目录——目标是目录时 mv 走 rename(2) 覆盖同名的旧 current，
   * 不依赖 GNU 专有的 `mv -T`（busybox / BSD 同样可用）；根目录下若有人手工建了真目录 current，rename 会直接失败而不是覆盖。
   */
  async switchCurrent(step: DeployStep, releaseName: string): Promise<void> {
    const staging = `${this.layout.releases}/current`;
    await this.run('ln', ['-sfn', `releases/${releaseName}`, staging]);
    await this.run('mv', ['-f', staging, `${this.layout.root}/`]);
    await this.log('info', step, `current -> releases/${releaseName}`);
  }

  async restart(step: DeployStep, releaseName: string | null, previousReleaseName: string | null): Promise<void> {
    const { snapshot } = this.input;
    if (snapshot.restartMode === 'none') {
      await this.log('info', step, '重启方式为「无需重启」，跳过');
      return;
    }
    if (snapshot.restartMode === 'systemd') {
      const unit = snapshot.serviceName!;
      await this.log('info', step, `systemctl restart ${unit}`);
      await this.run('systemctl', ['restart', unit], STEP_TIMEOUT_MS.restart);
      const state = await this.tryRun('systemctl', ['is-active', unit]);
      await this.log('info', step, `${unit}: ${state?.stdout.trim() || 'unknown'}`);
      return;
    }
    const script = snapshot.scripts.restart!;
    await this.log('info', step, `$ ${script.split('\n')[0]}${script.includes('\n') ? ' …' : ''}`);
    await this.runScript(step, this.layout.current, script, this.envPairs(releaseName, previousReleaseName), STEP_TIMEOUT_MS.restart);
  }

  async healthCheck(step: DeployStep, releaseName: string | null, previousReleaseName: string | null): Promise<void> {
    const hc = this.input.snapshot.healthCheck;
    if (hc.type === 'none') {
      await this.log('info', step, '未配置健康检查，跳过');
      return;
    }
    const attempts = hc.retries + 1;
    let lastError = '';
    for (let i = 1; i <= attempts; i++) {
      try {
        if (hc.type === 'http') {
          const res = await this.run('curl', ['-fsS', '-o', '/dev/null', '-w', '%{http_code}', '-m', String(hc.timeoutSeconds), hc.url!], (hc.timeoutSeconds + 5) * 1000);
          await this.log('info', step, `GET ${hc.url} → ${res.stdout.trim()}（第 ${i} 次）`);
        } else if (hc.type === 'tcp') {
          await this.run('timeout', [String(hc.timeoutSeconds), 'bash', '-c', 'exec 3<>"/dev/tcp/127.0.0.1/$1"', 'arcbase-deploy', String(hc.port)], (hc.timeoutSeconds + 5) * 1000);
          await this.log('info', step, `TCP 127.0.0.1:${hc.port} 可连接（第 ${i} 次）`);
        } else {
          await this.runScript(step, this.layout.current, hc.command!, this.envPairs(releaseName, previousReleaseName), hc.timeoutSeconds * 1000);
          await this.log('info', step, `健康检查命令退出码 0（第 ${i} 次）`);
        }
        return;
      } catch (err) {
        if (err instanceof DeployCancelledError) throw err;
        lastError = errorText(err);
        await this.log('warn', step, `健康检查未通过（${i}/${attempts}）：${lastError}`);
        if (i < attempts) await new Promise((r) => setTimeout(r, hc.intervalSeconds * 1000));
      }
    }
    throw new Error(`健康检查 ${attempts} 次未通过：${lastError}`);
  }
}

// ─── 各步骤 ──────────────────────────────────────────────────────────────────

async function preflight(s: HostSession): Promise<{ previousReleaseName: string | null }> {
  await s.step('preflight');
  const { layout, input } = s;
  const started = Date.now();
  await s.run('mkdir', ['-p', layout.releases, layout.shared, layout.tmp]);
  await s.log('info', 'preflight', `布局就位：${layout.root}/{releases,shared,tmp}（${Date.now() - started}ms）`);
  const previousReleaseName = await s.readCurrent();
  await s.log('info', 'preflight', previousReleaseName ? `当前版本：${previousReleaseName}` : '当前无运行版本（首次部署）');

  if (input.kind === 'deploy') {
    const artifact = input.artifact!;
    const needed: string[] = ['tar', 'sha256sum'];
    const kind = archiveKind(artifact.fileName);
    if (kind === 'zip') needed.push('unzip');
    if (input.snapshot.healthCheck.type === 'http') needed.push('curl');
    if (input.snapshot.restartMode === 'systemd') needed.push('systemctl');
    for (const bin of needed) {
      const found = await s.tryRun('command', ['-v', bin]);
      if (!found) throw new Error(`主机缺少 ${bin}，无法继续`);
    }
    const df = await s.tryRun('df', ['-Pk', layout.root]);
    const availKb = df ? Number(df.stdout.trim().split('\n').at(-1)?.split(/\s+/)[3]) : NaN;
    if (Number.isFinite(availKb)) {
      const needBytes = artifact.size * 2.5;
      await s.log('info', 'preflight', `磁盘可用 ${(availKb / 1024 / 1024).toFixed(1)} GB，制品 ${(artifact.size / 1024 / 1024).toFixed(1)} MB`);
      if (availKb * 1024 < needBytes) throw new Error(`磁盘空间不足：需要约 ${(needBytes / 1024 / 1024).toFixed(0)} MB`);
    }
  }
  if (input.kind === 'rollback') {
    const releases = await s.listReleases();
    if (!input.releaseName || !releases.includes(input.releaseName)) throw new Error(`主机上不存在 release ${input.releaseName}`);
    if (previousReleaseName === input.releaseName) await s.log('warn', 'preflight', '目标 release 已是 current，将只执行重启与健康检查');
  }
  return { previousReleaseName };
}

/** 流式上传到 tmp/，远端 sha256 校验；tmp/ 已有同 sha 文件时跳过重传（重试幂等） */
async function upload(s: HostSession, remoteFile: string): Promise<{ skipped: boolean }> {
  await s.step('upload');
  const artifact = s.input.artifact!;
  const expected = artifact.sha256;
  if (expected) {
    const existing = await s.tryRun('sha256sum', [remoteFile], STEP_TIMEOUT_MS.unpack);
    if (existing && existing.stdout.trim().split(/\s+/)[0] === expected) {
      await s.log('info', 'upload', `tmp/ 已有同 sha256 的制品，跳过上传`);
      return { skipped: true };
    }
  }
  await s.log('info', 'upload', `上传 ${artifact.fileName}（${(artifact.size / 1024 / 1024).toFixed(1)} MB）→ ${remoteFile}`);
  const { sftp, release } = await s.exec.acquireSftp();
  const hash = createHash('sha256');
  let sent = 0;
  let nextMark = 0.25;
  const started = Date.now();
  try {
    const source = Readable.fromWeb(await artifact.open() as import('node:stream/web').ReadableStream<Uint8Array>);
    const counter = new Transform({
      transform: (chunk: Buffer, _enc, cb) => {
        hash.update(chunk);
        sent += chunk.length;
        if (artifact.size > 0 && sent / artifact.size >= nextMark) {
          void s.log('info', 'upload', `已上传 ${Math.round((sent / artifact.size) * 100)}%`);
          nextMark += 0.25;
        }
        cb(null, chunk);
      },
    });
    await pipeline(source, counter, sftp.createWriteStream(remoteFile));
  } finally {
    release();
  }
  const localSha = hash.digest('hex');
  if (expected && localSha !== expected) throw new Error('制品内容与登记的 sha256 不一致，存储侧文件可能已损坏');
  const remote = await s.run('sha256sum', [remoteFile], STEP_TIMEOUT_MS.unpack);
  const remoteSha = remote.stdout.trim().split(/\s+/)[0];
  if (remoteSha !== localSha) throw new Error(`上传后 sha256 不一致（远端 ${remoteSha.slice(0, 12)}… ≠ ${localSha.slice(0, 12)}…）`);
  await s.log('info', 'upload', `sha256 校验一致（${((Date.now() - started) / 1000).toFixed(1)}s，${(sent / 1024 / 1024 / Math.max(0.001, (Date.now() - started) / 1000)).toFixed(1)} MB/s）`);
  return { skipped: false };
}

async function unpack(s: HostSession, remoteFile: string, releaseName: string): Promise<void> {
  await s.step('unpack');
  const { layout, input } = s;
  const artifact = input.artifact!;
  const releaseDir = layout.release(releaseName);
  // 重试幂等：同名目录若已存在（上次中断），清掉重来
  await s.run('rm', ['-rf', releaseDir], STEP_TIMEOUT_MS.prune);
  await s.run('mkdir', ['-p', releaseDir]);
  const kind = archiveKind(artifact.fileName);
  if (kind === 'tar.gz') await s.run('tar', ['-xzf', remoteFile, '-C', releaseDir], STEP_TIMEOUT_MS.unpack);
  else if (kind === 'tar') await s.run('tar', ['-xf', remoteFile, '-C', releaseDir], STEP_TIMEOUT_MS.unpack);
  else if (kind === 'zip') await s.run('unzip', ['-q', '-o', remoteFile, '-d', releaseDir], STEP_TIMEOUT_MS.unpack);
  else await s.run('cp', ['-f', remoteFile, `${releaseDir}/${artifact.fileName}`], STEP_TIMEOUT_MS.unpack);
  await s.log('info', 'unpack', `${kind === 'file' ? '复制' : '解包'} → releases/${releaseName}`);

  for (const rel of input.snapshot.sharedPaths) {
    const sharedTarget = `${layout.shared}/${rel}`;
    const inRelease = `${releaseDir}/${rel}`;
    await s.run('mkdir', ['-p', sharedTarget.slice(0, sharedTarget.lastIndexOf('/')), inRelease.slice(0, inRelease.lastIndexOf('/'))]);
    // 首次：shared/ 里还没有，而制品自带了默认内容 → 先把默认内容搬到 shared/ 作为种子
    const sharedExists = await s.tryRun('test', ['-e', sharedTarget]);
    const releaseHas = await s.tryRun('test', ['-e', inRelease]);
    if (!sharedExists) {
      if (releaseHas) {
        await s.run('cp', ['-a', inRelease, sharedTarget], STEP_TIMEOUT_MS.unpack);
        await s.log('info', 'unpack', `shared/${rel} 不存在，以制品自带内容初始化`);
      } else {
        await s.run('mkdir', ['-p', sharedTarget]);
      }
    }
    await s.run('rm', ['-rf', inRelease], STEP_TIMEOUT_MS.prune);
    await s.run('ln', ['-sfn', sharedTarget, inRelease]);
    await s.log('info', 'unpack', `软链 ${rel} -> shared/${rel}`);
  }
  await s.tryRun('rm', ['-f', remoteFile]);
}

async function prune(s: HostSession, keepName: string, previousReleaseName: string | null): Promise<{ pruned: string[]; sizeBytes: number | null }> {
  await s.step('prune');
  const { layout, input } = s;
  const du = await s.tryRun('du', ['-sk', layout.release(keepName)], STEP_TIMEOUT_MS.prune);
  const sizeKb = du ? Number(du.stdout.trim().split(/\s+/)[0]) : NaN;
  const sizeBytes = Number.isFinite(sizeKb) ? sizeKb * 1024 : null;
  const current = await s.readCurrent();
  // 上一版永远保留（它就是回滚目标），并计入保留数；其余按名字（14 位时间戳前缀）倒序 = 从新到旧
  const all = await s.listReleases();
  const protectedPrevious = previousReleaseName && previousReleaseName !== keepName && all.includes(previousReleaseName) ? previousReleaseName : null;
  const candidates = all
    .filter((name) => name !== keepName && name !== current && name !== protectedPrevious)
    .sort((a, b) => b.localeCompare(a));
  const doomed = candidates.slice(Math.max(0, input.snapshot.keepReleases - (protectedPrevious ? 1 : 0)));
  if (doomed.length === 0) {
    await s.log('info', 'prune', `保留 ${input.snapshot.keepReleases} 个历史 release，无需清理`);
    return { pruned: [], sizeBytes };
  }
  await s.run('rm', ['-rf', ...doomed.map((name) => layout.release(name))], STEP_TIMEOUT_MS.prune);
  await s.log('info', 'prune', `清理 ${doomed.length} 个旧 release：${doomed.join(', ')}`);
  return { pruned: doomed, sizeBytes };
}

// ─── 主流程 ──────────────────────────────────────────────────────────────────

/**
 * 执行一台主机的完整流水线。抛出 DeployStepError（含步骤与是否已回滚）或 DeployCancelledError。
 */
export async function runHostPipeline(input: HostPipelineInput): Promise<HostPipelineResult> {
  const layout = layoutOf(input.snapshot.deployPath);
  const s = new HostSession(input, layout);
  const result: HostPipelineResult = { previousReleaseName: null, rolledBack: false, sizeBytes: null, prunedReleaseNames: [], uploadSkipped: false };
  let step: DeployStep = 'preflight';
  let switched = false;

  const fail = (message: string): never => { throw new DeployStepError(step, message, false, result.previousReleaseName); };

  try {
    if (input.kind !== 'restart') {
      const pre = await preflight(s);
      result.previousReleaseName = pre.previousReleaseName;
    } else {
      await s.step('preflight');
      result.previousReleaseName = await s.readCurrent();
      if (!result.previousReleaseName) fail('当前无运行版本，无法重启');
    }

    const releaseName = input.kind === 'restart' ? result.previousReleaseName : input.releaseName;

    if (input.kind === 'deploy') {
      if (!releaseName || !input.artifact) fail('缺少 release 名或制品');
      const remoteFile = `${layout.tmp}/${releaseName}-${input.artifact!.fileName.replaceAll(/[^A-Za-z0-9._-]/g, '_')}`;
      step = 'upload';
      result.uploadSkipped = (await upload(s, remoteFile)).skipped;
      step = 'unpack';
      await unpack(s, remoteFile, releaseName!);
      step = 'before_switch';
      if (input.snapshot.scripts.beforeSwitch?.trim()) {
        await s.step('before_switch');
        await s.log('info', 'before_switch', `$ ${input.snapshot.scripts.beforeSwitch.split('\n')[0]}`);
        await s.runScript('before_switch', layout.release(releaseName!), input.snapshot.scripts.beforeSwitch, s.envPairs(releaseName, result.previousReleaseName), STEP_TIMEOUT_MS.hook);
      }
    }

    if (input.kind !== 'restart') {
      step = 'switch';
      await s.step('switch');
      if (result.previousReleaseName === releaseName) {
        await s.log('info', 'switch', 'current 已指向目标 release，无需切换');
      } else {
        await s.switchCurrent('switch', releaseName!);
        switched = true;
      }
    }

    step = 'restart';
    await s.step('restart');
    await s.restart('restart', releaseName, result.previousReleaseName);

    step = 'health_check';
    await s.step('health_check');
    await s.healthCheck('health_check', releaseName, result.previousReleaseName);

    if (input.kind === 'deploy') {
      step = 'prune';
      const pruned = await prune(s, releaseName!, result.previousReleaseName);
      result.prunedReleaseNames = pruned.pruned;
      result.sizeBytes = pruned.sizeBytes;
    }
    return result;
  } catch (err) {
    if (err instanceof DeployCancelledError) throw err;
    if (err instanceof DeployStepError) throw err;
    const message = errorText(err);
    await s.log('error', step, message);
    // switch 之后失败：按策略切回上一版并重启，让主机回到可用状态
    if (switched && input.snapshot.autoRollback && result.previousReleaseName) {
      try {
        await s.log('warn', step, `autoRollback 开启 → 切回 ${result.previousReleaseName} 并重启`);
        await s.switchCurrent(step, result.previousReleaseName);
        await s.restart(step, result.previousReleaseName, input.releaseName);
        result.rolledBack = true;
        await s.log('warn', step, '已自动回滚到上一版');
      } catch (rollbackErr) {
        await s.log('error', step, `自动回滚失败：${errorText(rollbackErr)}`);
      }
    }
    throw new DeployStepError(step, message, result.rolledBack, result.previousReleaseName);
  }
}

/** 对账：读取主机上的 current 与 releases 目录（供登记表校正） */
export async function inspectHostReleases(executor: RemoteHostExecutor, deployPath: string): Promise<{ current: string | null; releases: string[] }> {
  const layout = layoutOf(deployPath);
  const s = new HostSession({ kind: 'restart', executor, snapshot: { deployPath } as DeployRunSnapshot, releaseName: null, version: null, appKey: '', log: () => {} }, layout);
  const [current, releases] = await Promise.all([s.readCurrent(), s.listReleases()]);
  return { current, releases };
}

/** 删除主机上的一个 release 目录（调用方已保证它不是 current） */
export async function removeHostRelease(executor: RemoteHostExecutor, deployPath: string, releaseName: string): Promise<void> {
  const layout = layoutOf(deployPath);
  await executor.exec('rm', ['-rf', layout.release(releaseName)], { timeoutMs: STEP_TIMEOUT_MS.prune });
}
