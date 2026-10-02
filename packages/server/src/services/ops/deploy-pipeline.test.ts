import { createHash } from 'node:crypto';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { DeployRunSnapshot, DeployStep } from '@arcbase/shared/ops';
import { HostExecError, type ExecResult, type RemoteHostExecutor, type StreamHandle, type StreamOptions } from '../../lib/host-exec';
import {
  DeployCancelledError,
  DeployStepError,
  inspectHostReleases,
  layoutOf,
  releaseNameFor,
  runHostPipeline,
  versionFromReleaseName,
  type HostPipelineInput,
} from './deploy-pipeline';

// ─── 假主机：用内存模型模拟 releases/ current / tmp 与常用命令 ───────────────

interface FakeHostOptions {
  current?: string | null;
  releases?: string[];
  /** tmp/ 里已有的文件 → sha256 */
  files?: Record<string, string>;
  missingBinaries?: string[];
  /** 健康检查前 N 次失败 */
  healthFailures?: number;
  restartFails?: boolean;
  /** shared/ 下已存在的相对路径 */
  sharedExisting?: string[];
  /** 制品解包后 release 目录里自带的相对路径 */
  releaseContents?: string[];
  availKb?: number;
}

class FakeHost implements RemoteHostExecutor {
  readonly hostId = 1;
  readonly isRemote = true;
  readonly calls: string[] = [];
  readonly scripts: Array<{ cwd: string; env: string[]; script: string }> = [];
  current: string | null;
  releases: Set<string>;
  files: Record<string, string>;
  shared: Set<string>;
  releaseFiles = new Map<string, Set<string>>();
  symlinks: Array<{ target: string; link: string }> = [];
  healthAttempts = 0;
  restartCount = 0;

  constructor(readonly root: string, readonly opts: FakeHostOptions = {}) {
    this.current = opts.current ?? null;
    this.releases = new Set(opts.releases ?? []);
    this.files = { ...(opts.files ?? {}) };
    this.shared = new Set(opts.sharedExisting ?? []);
  }

  private fail(message: string, code = 1): never {
    throw new HostExecError(message, '', message, code);
  }

  async exec(file: string, args: readonly string[] = []): Promise<ExecResult> {
    this.calls.push([file, ...args].join(' '));
    const ok = (stdout = ''): ExecResult => ({ stdout, stderr: '' });
    const L = layoutOf(this.root);
    switch (file) {
      case 'mkdir':
      case 'cp':
      case 'unzip':
        if (file === 'cp' && args[0] === '-a') {
          // 把 release 内容搬进 shared/
          const rel = args[2].slice(L.shared.length + 1);
          this.shared.add(rel);
        }
        return ok();
      case 'readlink': {
        if (!this.current) this.fail('readlink: No such file');
        return ok(`releases/${this.current}\n`);
      }
      case 'command': {
        if (this.opts.missingBinaries?.includes(args[1])) this.fail('', 127);
        return ok(`/usr/bin/${args[1]}\n`);
      }
      case 'df':
        return ok(`Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/sda1 100000000 50000000 ${this.opts.availKb ?? 40_000_000} 50% /\n`);
      case 'sha256sum': {
        const sha = this.files[args[0]];
        if (!sha) this.fail(`sha256sum: ${args[0]}: No such file or directory`);
        return ok(`${sha}  ${args[0]}\n`);
      }
      case 'tar': {
        const dir = args[3];
        const name = dir.slice(L.releases.length + 1);
        this.releases.add(name);
        this.releaseFiles.set(name, new Set(this.opts.releaseContents ?? []));
        return ok();
      }
      case 'test': {
        const p = args[1];
        if (p.startsWith(L.shared + '/')) return this.shared.has(p.slice(L.shared.length + 1)) ? ok() : this.fail('', 1);
        if (p.startsWith(L.releases + '/')) {
          const [name, ...rest] = p.slice(L.releases.length + 1).split('/');
          return this.releaseFiles.get(name)?.has(rest.join('/')) ? ok() : this.fail('', 1);
        }
        return this.fail('', 1);
      }
      case 'ln':
        this.symlinks.push({ target: args[1], link: args[2] });
        return ok();
      case 'mv': {
        // mv -f releases/current <root>/：按最近一次指向 releases/current 的 ln 决定新 current
        const staged = this.symlinks.filter((s) => s.link === args[1]).at(-1);
        if (!staged || args[2] !== `${this.root}/`) this.fail('mv: nothing staged');
        this.current = staged.target.replace(/^releases\//, '');
        return ok();
      }
      case 'systemctl': {
        if (args[0] === 'restart') {
          this.restartCount += 1;
          if (this.opts.restartFails) this.fail('Job for app.service failed', 1);
          return ok();
        }
        return ok('active\n');
      }
      case 'curl': {
        this.healthAttempts += 1;
        if (this.healthAttempts <= (this.opts.healthFailures ?? 0)) this.fail('curl: (7) Failed to connect', 7);
        return ok('200');
      }
      case 'timeout':
        return ok();
      case 'ls': {
        return ok([...this.releases].join('\n') + '\n');
      }
      case 'du':
        return ok(`2048\t${args[1]}\n`);
      case 'rm': {
        for (const p of args.slice(1)) {
          if (p.startsWith(L.releases + '/')) this.releases.delete(p.slice(L.releases.length + 1).split('/')[0]);
          if (p.startsWith(L.tmp + '/')) delete this.files[p];
        }
        return ok();
      }
      default:
        this.fail(`unknown command ${file}`, 127);
    }
  }

  async execStream(file: string, args: readonly string[], opts: StreamOptions): Promise<StreamHandle> {
    this.calls.push(`[stream] ${[file, ...args.slice(0, 2)].join(' ')}`);
    // bash -c 'cd -- "$1" && shift && exec "$@"' arcbase-deploy <cwd> env K=V… bash -c <script>
    const cwd = args[3];
    const envEnd = args.indexOf('bash', 4);
    const env = args.slice(5, envEnd);
    const script = args[envEnd + 2];
    this.scripts.push({ cwd, env, script });
    setImmediate(() => {
      opts.onData('hello from script\nsecond line');
      opts.onExit?.(script.includes('exit 3') ? 3 : 0);
    });
    return { kill: () => {} };
  }

  async acquireSftp() {
    const files = this.files;
    const sftp = {
      createWriteStream: (path: string) => {
        const hash = createHash('sha256');
        return new Writable({
          write(chunk: Buffer, _enc, cb) {
            hash.update(chunk);
            cb();
          },
          final(cb) {
            files[path] = hash.digest('hex');
            cb();
          },
        });
      },
    };
    return { sftp: sftp as unknown as Awaited<ReturnType<RemoteHostExecutor['acquireSftp']>>['sftp'], release: () => {} };
  }
}

// ─── 夹具 ────────────────────────────────────────────────────────────────────

const ROOT = '/opt/apps/order-svc';
const ARTIFACT_BYTES = Buffer.from('fake-archive-content');
const ARTIFACT_SHA = createHash('sha256').update(ARTIFACT_BYTES).digest('hex');

function snapshot(overrides: Partial<DeployRunSnapshot> = {}): DeployRunSnapshot {
  return {
    deployPath: ROOT,
    sharedPaths: [],
    keepReleases: 2,
    restartMode: 'systemd',
    serviceName: 'order-svc',
    scripts: { beforeSwitch: null, restart: null },
    healthCheck: { type: 'http', url: 'http://127.0.0.1:8080/health', port: null, command: null, timeoutSeconds: 5, retries: 2, intervalSeconds: 0 },
    env: {},
    autoRollback: true,
    strategy: 'rolling',
    maxParallel: 1,
    stopOnFailure: true,
    ...overrides,
  };
}

function artifact(sha: string | null = ARTIFACT_SHA) {
  return {
    fileName: 'order-svc-1.2.0.tar.gz',
    size: ARTIFACT_BYTES.length,
    sha256: sha,
    open: async () => new Blob([ARTIFACT_BYTES]).stream() as ReadableStream<Uint8Array>,
  };
}

function makeInput(host: FakeHost, overrides: Partial<HostPipelineInput> = {}) {
  const steps: DeployStep[] = [];
  const logs: string[] = [];
  const input: HostPipelineInput = {
    kind: 'deploy',
    executor: host,
    snapshot: snapshot(),
    releaseName: '20260101120000-1.2.0',
    version: '1.2.0',
    appKey: 'order-svc',
    artifact: artifact(),
    log: (level, step, line) => { logs.push(`${level}${step ? `@${step}` : ''}: ${line}`); },
    onStep: (step) => { steps.push(step); },
    ...overrides,
  };
  return { input, steps, logs };
}

// ─── 用例 ────────────────────────────────────────────────────────────────────

describe('releaseNameFor / versionFromReleaseName', () => {
  it('生成 14 位时间戳 + 版本，并能反解版本', () => {
    const name = releaseNameFor('1.2.0', new Date(2026, 0, 1, 12, 0, 0));
    expect(name).toBe('20260101120000-1.2.0');
    expect(versionFromReleaseName(name)).toBe('1.2.0');
    expect(versionFromReleaseName('garbage')).toBeNull();
  });

  it('版本里的非法字符被替换', () => {
    expect(releaseNameFor('1.0.0+build/7', new Date(2026, 0, 1))).toBe('20260101000000-1.0.0-build-7');
  });
});

describe('runHostPipeline · deploy', () => {
  it('首次部署：完整步骤顺序，切换 current，重启并健康检查，登记大小', async () => {
    const host = new FakeHost(ROOT);
    const { input, steps, logs } = makeInput(host);
    const result = await runHostPipeline(input);

    expect(steps).toEqual(['preflight', 'upload', 'unpack', 'switch', 'restart', 'health_check', 'prune']);
    expect(result).toMatchObject({ previousReleaseName: null, rolledBack: false, sizeBytes: 2048 * 1024, prunedReleaseNames: [], uploadSkipped: false });
    expect(host.current).toBe('20260101120000-1.2.0');
    expect(host.restartCount).toBe(1);
    expect(host.healthAttempts).toBe(1);
    // 原子切换：先在 releases/ 里建临时软链，再 mv 进根目录（rename 覆盖旧 current）
    expect(host.calls).toContain(`ln -sfn releases/20260101120000-1.2.0 ${ROOT}/releases/current`);
    expect(host.calls).toContain(`mv -f ${ROOT}/releases/current ${ROOT}/`);
    // 上传后校验远端 sha256，之后删除 tmp 制品
    expect(host.calls.filter((c) => c.startsWith('sha256sum'))).toHaveLength(2);
    expect(Object.keys(host.files)).toHaveLength(0);
    expect(logs.some((l) => l.includes('首次部署'))).toBe(true);
  });

  it('tmp/ 已有同 sha256 的制品时跳过上传', async () => {
    const remoteFile = `${ROOT}/tmp/20260101120000-1.2.0-order-svc-1.2.0.tar.gz`;
    const host = new FakeHost(ROOT, { files: { [remoteFile]: ARTIFACT_SHA } });
    const { input } = makeInput(host);
    const result = await runHostPipeline(input);
    expect(result.uploadSkipped).toBe(true);
    expect(host.calls.filter((c) => c.startsWith('sha256sum'))).toHaveLength(1);
  });

  it('存储侧内容与登记 sha256 不一致 → upload 步骤失败，不切换', async () => {
    const host = new FakeHost(ROOT, { current: '20251201000000-1.1.0', releases: ['20251201000000-1.1.0'] });
    const { input } = makeInput(host, { artifact: artifact('0'.repeat(64)) });
    const err = await runHostPipeline(input).catch((e) => e);
    expect(err).toBeInstanceOf(DeployStepError);
    expect((err as DeployStepError).step).toBe('upload');
    expect(host.current).toBe('20251201000000-1.1.0');
  });

  it('按保留策略清理旧 release（保留 keepReleases 个历史版本，永不删 current）', async () => {
    const old = ['20250101000000-0.7.0', '20250201000000-0.8.0', '20250301000000-0.9.0', '20251201000000-1.1.0'];
    const host = new FakeHost(ROOT, { current: '20251201000000-1.1.0', releases: old });
    const { input } = makeInput(host, { snapshot: snapshot({ keepReleases: 2 }) });
    const result = await runHostPipeline(input);
    expect(result.previousReleaseName).toBe('20251201000000-1.1.0');
    expect(result.prunedReleaseNames).toEqual(['20250201000000-0.8.0', '20250101000000-0.7.0']);
    expect([...host.releases].sort()).toEqual(['20250301000000-0.9.0', '20251201000000-1.1.0', '20260101120000-1.2.0']);
    const rmCall = host.calls.find((c) => c.startsWith('rm -rf') && c.includes('0.8.0'));
    expect(rmCall).toBe(`rm -rf ${ROOT}/releases/20250201000000-0.8.0 ${ROOT}/releases/20250101000000-0.7.0`);
  });

  it('清理时上一版永远保留（即使主机上有更新的失败残留目录）', async () => {
    // 1.1.0-a 部署失败留下的目录名比上一版 1.0.0 新；keepReleases = 1 时应删掉残留而保留回滚目标 1.0.0
    const host = new FakeHost(ROOT, { current: '20251201000000-1.0.0', releases: ['20251201000000-1.0.0', '20251215000000-1.1.0'] });
    const { input } = makeInput(host, { snapshot: snapshot({ keepReleases: 1 }), releaseName: '20260101120000-1.2.0' });
    const result = await runHostPipeline(input);
    expect(result.prunedReleaseNames).toEqual(['20251215000000-1.1.0']);
    expect([...host.releases].sort()).toEqual(['20251201000000-1.0.0', '20260101120000-1.2.0']);
  });

  it('健康检查重试后仍失败且 autoRollback 开启 → 切回上一版并重启，结果 rolled_back', async () => {
    const host = new FakeHost(ROOT, { current: '20251201000000-1.1.0', releases: ['20251201000000-1.1.0'], healthFailures: 10 });
    const { input, logs } = makeInput(host);
    const err = await runHostPipeline(input).catch((e) => e);
    expect(err).toBeInstanceOf(DeployStepError);
    const stepErr = err as DeployStepError;
    expect(stepErr.step).toBe('health_check');
    expect(stepErr.rolledBack).toBe(true);
    expect(stepErr.previousReleaseName).toBe('20251201000000-1.1.0');
    expect(host.healthAttempts).toBe(3); // retries 2 → 3 次
    expect(host.current).toBe('20251201000000-1.1.0');
    expect(host.restartCount).toBe(2);
    expect(logs.some((l) => l.includes('已自动回滚'))).toBe(true);
  });

  it('autoRollback 关闭时健康检查失败只报错，current 留在新版', async () => {
    const host = new FakeHost(ROOT, { current: '20251201000000-1.1.0', releases: ['20251201000000-1.1.0'], healthFailures: 10 });
    const { input } = makeInput(host, { snapshot: snapshot({ autoRollback: false }) });
    const err = await runHostPipeline(input).catch((e) => e);
    expect((err as DeployStepError).rolledBack).toBe(false);
    expect(host.current).toBe('20260101120000-1.2.0');
    expect(host.restartCount).toBe(1);
  });

  it('首次部署（无上一版）健康检查失败：无处可回滚，记为 failed', async () => {
    const host = new FakeHost(ROOT, { healthFailures: 10 });
    const { input } = makeInput(host);
    const err = await runHostPipeline(input).catch((e) => e);
    expect((err as DeployStepError).rolledBack).toBe(false);
    expect((err as DeployStepError).step).toBe('health_check');
  });

  it('切换之前请求取消 → DeployCancelledError，current 不变', async () => {
    const host = new FakeHost(ROOT, { current: '20251201000000-1.1.0', releases: ['20251201000000-1.1.0'] });
    let cancelled = false;
    const { input, steps } = makeInput(host, {
      isCancelled: () => cancelled,
      onStep: (step) => { steps.push(step); if (step === 'unpack') cancelled = true; },
    });
    await expect(runHostPipeline(input)).rejects.toBeInstanceOf(DeployCancelledError);
    expect(steps).toEqual(['preflight', 'upload', 'unpack']);
    expect(host.current).toBe('20251201000000-1.1.0');
  });

  it('切换之后的取消请求不打断 restart / health_check，部署照常完成', async () => {
    const host = new FakeHost(ROOT, { current: '20251201000000-1.1.0', releases: ['20251201000000-1.1.0'] });
    let cancelled = false;
    const { input } = makeInput(host, {
      isCancelled: () => cancelled,
      onStep: (step) => { if (step === 'restart') cancelled = true; },
    });
    const result = await runHostPipeline(input);
    expect(result.rolledBack).toBe(false);
    expect(host.current).toBe('20260101120000-1.2.0');
    expect(host.healthAttempts).toBe(1);
  });

  it('主机缺少所需命令 → preflight 失败', async () => {
    const host = new FakeHost(ROOT, { missingBinaries: ['curl'] });
    const { input } = makeInput(host);
    const err = await runHostPipeline(input).catch((e) => e);
    expect((err as DeployStepError).step).toBe('preflight');
    expect((err as DeployStepError).message).toContain('curl');
  });

  it('磁盘空间不足 → preflight 失败', async () => {
    const host = new FakeHost(ROOT, { availKb: 0 });
    const { input } = makeInput(host);
    const err = await runHostPipeline(input).catch((e) => e);
    expect((err as DeployStepError).step).toBe('preflight');
    expect((err as DeployStepError).message).toContain('磁盘空间不足');
  });

  it('sharedPaths：shared/ 缺失时以制品自带内容初始化，然后软链进 release', async () => {
    const host = new FakeHost(ROOT, { sharedExisting: ['logs'], releaseContents: ['config/application.yml'] });
    const { input } = makeInput(host, { snapshot: snapshot({ sharedPaths: ['logs', 'config/application.yml'] }) });
    await runHostPipeline(input);
    const releaseDir = `${ROOT}/releases/20260101120000-1.2.0`;
    // logs 已存在于 shared/：不搬运
    expect(host.calls).not.toContain(`cp -a ${releaseDir}/logs ${ROOT}/shared/logs`);
    // application.yml 不在 shared/ 但制品自带：先搬到 shared/ 作为种子
    expect(host.calls).toContain(`cp -a ${releaseDir}/config/application.yml ${ROOT}/shared/config/application.yml`);
    expect(host.symlinks).toContainEqual({ target: `${ROOT}/shared/logs`, link: `${releaseDir}/logs` });
    expect(host.symlinks).toContainEqual({ target: `${ROOT}/shared/config/application.yml`, link: `${releaseDir}/config/application.yml` });
  });

  it('before_switch 钩子在 release 目录内执行并带上部署环境变量；脚本非零退出 → 步骤失败且不切换', async () => {
    const host = new FakeHost(ROOT, { current: '20251201000000-1.1.0', releases: ['20251201000000-1.1.0'] });
    const { input, logs } = makeInput(host, { snapshot: snapshot({ scripts: { beforeSwitch: 'npm ci --omit=dev', restart: null }, env: { NODE_ENV: 'production' } }) });
    await runHostPipeline(input);
    expect(host.scripts).toHaveLength(1);
    expect(host.scripts[0].cwd).toBe(`${ROOT}/releases/20260101120000-1.2.0`);
    expect(host.scripts[0].env).toEqual(expect.arrayContaining([
      'NODE_ENV=production',
      'ARCBASE_APP_KEY=order-svc',
      'ARCBASE_VERSION=1.2.0',
      'ARCBASE_RELEASE_NAME=20260101120000-1.2.0',
      `ARCBASE_RELEASE_PATH=${ROOT}/releases/20260101120000-1.2.0`,
      `ARCBASE_CURRENT_PATH=${ROOT}/current`,
      'ARCBASE_PREVIOUS_RELEASE=20251201000000-1.1.0',
    ]));
    expect(logs.some((l) => l.includes('hello from script'))).toBe(true);

    const failing = new FakeHost(ROOT, { current: '20251201000000-1.1.0', releases: ['20251201000000-1.1.0'] });
    const bad = makeInput(failing, { snapshot: snapshot({ scripts: { beforeSwitch: 'exit 3', restart: null } }) });
    const err = await runHostPipeline(bad.input).catch((e) => e);
    expect((err as DeployStepError).step).toBe('before_switch');
    expect((err as DeployStepError).rolledBack).toBe(false);
    expect(failing.current).toBe('20251201000000-1.1.0');
  });

  it('restartMode = script 在 current 目录执行重启脚本；none 跳过', async () => {
    const host = new FakeHost(ROOT);
    const { input } = makeInput(host, { snapshot: snapshot({ restartMode: 'script', serviceName: null, scripts: { beforeSwitch: null, restart: 'pm2 reload app' } }) });
    await runHostPipeline(input);
    expect(host.scripts.at(-1)).toMatchObject({ cwd: `${ROOT}/current`, script: 'pm2 reload app' });
    expect(host.restartCount).toBe(0);

    const none = new FakeHost(ROOT);
    const { input: noneInput, logs } = makeInput(none, { snapshot: snapshot({ restartMode: 'none', serviceName: null }) });
    await runHostPipeline(noneInput);
    expect(none.restartCount).toBe(0);
    expect(logs.some((l) => l.includes('无需重启'))).toBe(true);
  });
});

describe('runHostPipeline · rollback / restart', () => {
  it('回滚：目标 release 必须在主机上存在', async () => {
    const host = new FakeHost(ROOT, { current: '20260101120000-1.2.0', releases: ['20260101120000-1.2.0'] });
    const { input } = makeInput(host, { kind: 'rollback', releaseName: '20251201000000-1.1.0', artifact: undefined });
    const err = await runHostPipeline(input).catch((e) => e);
    expect((err as DeployStepError).step).toBe('preflight');
    expect((err as DeployStepError).message).toContain('不存在 release');
  });

  it('回滚：跳过上传解包，直接切换 + 重启 + 健康检查', async () => {
    const host = new FakeHost(ROOT, { current: '20260101120000-1.2.0', releases: ['20251201000000-1.1.0', '20260101120000-1.2.0'] });
    const { input, steps } = makeInput(host, { kind: 'rollback', releaseName: '20251201000000-1.1.0', version: '1.1.0', artifact: undefined });
    const result = await runHostPipeline(input);
    expect(steps).toEqual(['preflight', 'switch', 'restart', 'health_check']);
    expect(result.previousReleaseName).toBe('20260101120000-1.2.0');
    expect(host.current).toBe('20251201000000-1.1.0');
    expect(result.prunedReleaseNames).toEqual([]);
  });

  it('回滚时健康检查失败 → 自动切回原来的版本', async () => {
    const host = new FakeHost(ROOT, { current: '20260101120000-1.2.0', releases: ['20251201000000-1.1.0', '20260101120000-1.2.0'], healthFailures: 10 });
    const { input } = makeInput(host, { kind: 'rollback', releaseName: '20251201000000-1.1.0', artifact: undefined });
    const err = await runHostPipeline(input).catch((e) => e);
    expect((err as DeployStepError).rolledBack).toBe(true);
    expect(host.current).toBe('20260101120000-1.2.0');
  });

  it('重启：只走 restart + health_check；无 current 时失败', async () => {
    const host = new FakeHost(ROOT, { current: '20260101120000-1.2.0', releases: ['20260101120000-1.2.0'] });
    const { input, steps } = makeInput(host, { kind: 'restart', releaseName: null, version: null, artifact: undefined });
    const result = await runHostPipeline(input);
    expect(steps).toEqual(['preflight', 'restart', 'health_check']);
    expect(result.previousReleaseName).toBe('20260101120000-1.2.0');
    expect(host.restartCount).toBe(1);

    const empty = new FakeHost(ROOT);
    const bad = makeInput(empty, { kind: 'restart', releaseName: null, version: null, artifact: undefined });
    const err = await runHostPipeline(bad.input).catch((e) => e);
    expect((err as DeployStepError).step).toBe('preflight');
    expect((err as DeployStepError).message).toContain('无运行版本');
  });

  it('重启失败不触发回滚（没有切换过）', async () => {
    const host = new FakeHost(ROOT, { current: '20260101120000-1.2.0', releases: ['20260101120000-1.2.0'], restartFails: true });
    const { input } = makeInput(host, { kind: 'restart', releaseName: null, version: null, artifact: undefined });
    const err = await runHostPipeline(input).catch((e) => e);
    expect((err as DeployStepError).step).toBe('restart');
    expect((err as DeployStepError).rolledBack).toBe(false);
  });
});

describe('inspectHostReleases', () => {
  it('读取 current 指向与 releases 目录；未初始化的主机返回空', async () => {
    const host = new FakeHost(ROOT, { current: '20260101120000-1.2.0', releases: ['20251201000000-1.1.0', '20260101120000-1.2.0', 'not-a-release'] });
    expect(await inspectHostReleases(host, ROOT)).toEqual({ current: '20260101120000-1.2.0', releases: ['20251201000000-1.1.0', '20260101120000-1.2.0'] });
    expect(await inspectHostReleases(new FakeHost(ROOT), ROOT)).toEqual({ current: null, releases: [] });
  });
});
