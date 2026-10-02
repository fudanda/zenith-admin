/**
 * 应用部署 Mock 数据（Demo 模式）。
 *
 * 服务端应用 order-svc（见 shared seed 的 SEED_DEMO_SERVICE_APPS）在两个环境上的部署目标、历史 run、
 * 逐行日志与主机上的 release 目录。主机取自 ops-hosts mock（1 生产应用节点 / 2 测试节点）。
 */
import type { DeployRelease, DeployRun, DeployRunHost, DeployRunLog, DeployTarget } from '@arcbase/shared/ops';
import { mockDateTimeOffset } from '@/mocks/utils/date';
import { nextIdFrom } from '@/mocks/utils/handlers';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

/** 与部署时间一致的 release 目录名：yyyyMMddHHmmss-<版本> */
function releaseNameAt(offsetMs: number, version: string): string {
  const stamp = mockDateTimeOffset(offsetMs).replaceAll(/[-: ]/g, '');
  return `${stamp}-${version}`;
}

const REL_141 = releaseNameAt(-3 * DAY, '1.4.1');
const REL_142 = releaseNameAt(-2 * HOUR, '1.4.2');
const REL_142_STAGING = releaseNameAt(-1 * DAY, '1.4.2');

export const mockDeployTargets: DeployTarget[] = [
  {
    id: 1, appId: 3, appKey: 'order-svc', appName: '订单服务', name: '生产', description: '双节点滚动发布',
    deployPath: '/opt/apps/order-svc', sharedPaths: ['logs', 'config'], keepReleases: 5,
    restartMode: 'systemd', serviceName: 'order-svc',
    scripts: { beforeSwitch: null, restart: null },
    healthCheck: { type: 'http', url: 'http://127.0.0.1:8080/actuator/health', port: null, command: null, timeoutSeconds: 5, retries: 10, intervalSeconds: 3 },
    env: { SPRING_PROFILES_ACTIVE: 'prod' },
    autoRollback: true, strategy: 'rolling', maxParallel: 2, stopOnFailure: true, enabled: true, remark: null,
    hosts: [
      { hostId: 1, hostName: '生产应用节点', host: '10.0.10.21', order: 0, hostEnabled: true, currentVersion: '1.4.2', currentReleaseName: REL_142, currentSince: mockDateTimeOffset(-2 * HOUR) },
    ],
    lastRun: { id: 3, kind: 'deploy', status: 'succeeded', version: '1.4.2', finishedAt: mockDateTimeOffset(-2 * HOUR + 90_000), createdAt: mockDateTimeOffset(-2 * HOUR) },
    createdAt: mockDateTimeOffset(-30 * DAY), updatedAt: mockDateTimeOffset(-2 * DAY),
  },
  {
    id: 2, appId: 3, appKey: 'order-svc', appName: '订单服务', name: '预发', description: null,
    deployPath: '/opt/apps/order-svc', sharedPaths: ['logs', 'config'], keepReleases: 3,
    restartMode: 'script', serviceName: null,
    scripts: { beforeSwitch: 'bash bin/migrate.sh', restart: 'bash bin/restart.sh' },
    healthCheck: { type: 'tcp', url: null, port: 8080, command: null, timeoutSeconds: 5, retries: 10, intervalSeconds: 3 },
    env: { SPRING_PROFILES_ACTIVE: 'staging' },
    autoRollback: true, strategy: 'rolling', maxParallel: 1, stopOnFailure: true, enabled: true, remark: '测试节点',
    hosts: [
      { hostId: 2, hostName: '测试节点', host: '10.0.20.31', order: 0, hostEnabled: true, currentVersion: '1.4.2', currentReleaseName: REL_142_STAGING, currentSince: mockDateTimeOffset(-1 * DAY) },
    ],
    lastRun: { id: 2, kind: 'deploy', status: 'succeeded', version: '1.4.2', finishedAt: mockDateTimeOffset(-1 * DAY + 70_000), createdAt: mockDateTimeOffset(-1 * DAY) },
    createdAt: mockDateTimeOffset(-30 * DAY), updatedAt: mockDateTimeOffset(-5 * DAY),
  },
];

const snapshotOf = (target: DeployTarget) => ({
  deployPath: target.deployPath, sharedPaths: target.sharedPaths, keepReleases: target.keepReleases,
  restartMode: target.restartMode, serviceName: target.serviceName, scripts: target.scripts, healthCheck: target.healthCheck,
  env: target.env, autoRollback: target.autoRollback, strategy: target.strategy, maxParallel: target.maxParallel, stopOnFailure: target.stopOnFailure,
});

export const mockDeployRunHosts: DeployRunHost[] = [
  { id: 1, runId: 1, hostId: 1, hostName: '生产应用节点', status: 'succeeded', step: 'prune', releaseName: REL_141, previousReleaseName: null, startedAt: mockDateTimeOffset(-3 * DAY), finishedAt: mockDateTimeOffset(-3 * DAY + 82_000), durationMs: 82_000, error: null },
  { id: 2, runId: 2, hostId: 2, hostName: '测试节点', status: 'succeeded', step: 'prune', releaseName: REL_142_STAGING, previousReleaseName: releaseNameAt(-6 * DAY, '1.4.1'), startedAt: mockDateTimeOffset(-1 * DAY), finishedAt: mockDateTimeOffset(-1 * DAY + 70_000), durationMs: 70_000, error: null },
  { id: 3, runId: 3, hostId: 1, hostName: '生产应用节点', status: 'succeeded', step: 'prune', releaseName: REL_142, previousReleaseName: REL_141, startedAt: mockDateTimeOffset(-2 * HOUR), finishedAt: mockDateTimeOffset(-2 * HOUR + 90_000), durationMs: 90_000, error: null },
  { id: 4, runId: 4, hostId: 2, hostName: '测试节点', status: 'rolled_back', step: 'health_check', releaseName: releaseNameAt(-2 * DAY, '1.4.2'), previousReleaseName: releaseNameAt(-6 * DAY, '1.4.1'), startedAt: mockDateTimeOffset(-2 * DAY), finishedAt: mockDateTimeOffset(-2 * DAY + 130_000), durationMs: 130_000, error: 'TCP 8080 在 30s 内未就绪（10 次重试），已自动回滚到上一版' },
];

export const mockDeployRuns: DeployRun[] = [
  {
    id: 1, appId: 3, appKey: 'order-svc', appName: '订单服务', targetId: 1, targetName: '生产', kind: 'deploy', status: 'succeeded',
    appReleaseId: 5, version: '1.4.1', artifactId: 9, artifactFileName: 'order-svc-1.4.1.tar.gz', releaseName: REL_141, asyncTaskId: null,
    hostTotal: 1, hostSucceeded: 1, hostFailed: 0, error: null, remark: '首次上线', snapshot: snapshotOf(mockDeployTargets[0]),
    createdByName: '管理员', startedAt: mockDateTimeOffset(-3 * DAY), finishedAt: mockDateTimeOffset(-3 * DAY + 82_000),
    createdAt: mockDateTimeOffset(-3 * DAY), updatedAt: mockDateTimeOffset(-3 * DAY + 82_000),
  },
  {
    id: 4, appId: 3, appKey: 'order-svc', appName: '订单服务', targetId: 2, targetName: '预发', kind: 'deploy', status: 'failed',
    appReleaseId: 6, version: '1.4.2', artifactId: 10, artifactFileName: 'order-svc-1.4.2.tar.gz', releaseName: releaseNameAt(-2 * DAY, '1.4.2'), asyncTaskId: null,
    hostTotal: 1, hostSucceeded: 0, hostFailed: 1, error: null, remark: null, snapshot: snapshotOf(mockDeployTargets[1]),
    createdByName: '管理员', startedAt: mockDateTimeOffset(-2 * DAY), finishedAt: mockDateTimeOffset(-2 * DAY + 130_000),
    createdAt: mockDateTimeOffset(-2 * DAY), updatedAt: mockDateTimeOffset(-2 * DAY + 130_000),
  },
  {
    id: 2, appId: 3, appKey: 'order-svc', appName: '订单服务', targetId: 2, targetName: '预发', kind: 'deploy', status: 'succeeded',
    appReleaseId: 6, version: '1.4.2', artifactId: 10, artifactFileName: 'order-svc-1.4.2.tar.gz', releaseName: REL_142_STAGING, asyncTaskId: null,
    hostTotal: 1, hostSucceeded: 1, hostFailed: 0, error: null, remark: '修复配置后重试', snapshot: snapshotOf(mockDeployTargets[1]),
    createdByName: '管理员', startedAt: mockDateTimeOffset(-1 * DAY), finishedAt: mockDateTimeOffset(-1 * DAY + 70_000),
    createdAt: mockDateTimeOffset(-1 * DAY), updatedAt: mockDateTimeOffset(-1 * DAY + 70_000),
  },
  {
    id: 3, appId: 3, appKey: 'order-svc', appName: '订单服务', targetId: 1, targetName: '生产', kind: 'deploy', status: 'succeeded',
    appReleaseId: 6, version: '1.4.2', artifactId: 10, artifactFileName: 'order-svc-1.4.2.tar.gz', releaseName: REL_142, asyncTaskId: null,
    hostTotal: 1, hostSucceeded: 1, hostFailed: 0, error: null, remark: null, snapshot: snapshotOf(mockDeployTargets[0]),
    createdByName: '管理员', startedAt: mockDateTimeOffset(-2 * HOUR), finishedAt: mockDateTimeOffset(-2 * HOUR + 90_000),
    createdAt: mockDateTimeOffset(-2 * HOUR), updatedAt: mockDateTimeOffset(-2 * HOUR + 90_000),
  },
];

function logsFor(runId: number, hostId: number, base: number, lines: Array<[DeployRunLog['level'], DeployRunLog['step'], string]>): DeployRunLog[] {
  return lines.map(([level, step, line], i) => ({
    id: runId * 1000 + i + 1, runId, hostId, seq: i + 1, level, step, line, createdAt: mockDateTimeOffset(base + i * 4000),
  }));
}

export const mockDeployRunLogs: DeployRunLog[] = [
  ...logsFor(3, 1, -2 * HOUR, [
    ['info', 'preflight', '连接 10.0.10.21:22 … ok（42ms）'],
    ['info', 'preflight', '磁盘可用 118 GB，布局 releases/ shared/ tmp/ 已就位'],
    ['info', 'upload', `上传 order-svc-1.4.2.tar.gz（66.0 MB）→ tmp/${REL_142}.tar.gz`],
    ['info', 'upload', 'sha256 校验一致'],
    ['info', 'unpack', `tar xzf → releases/${REL_142}`],
    ['info', 'unpack', '软链 shared/logs、shared/config'],
    ['info', 'switch', `current -> releases/${REL_142}（上一版 ${REL_141}）`],
    ['info', 'restart', 'systemctl restart order-svc … active (running)'],
    ['info', 'health_check', 'GET http://127.0.0.1:8080/actuator/health → 200 {"status":"UP"}（第 2 次）'],
    ['info', 'prune', '保留 5 个历史 release，无需清理'],
    ['info', 'prune', '完成，耗时 90s'],
  ]),
  ...logsFor(4, 2, -2 * DAY, [
    ['info', 'preflight', '连接 10.0.20.31:22 … ok（65ms）'],
    ['info', 'upload', '上传 order-svc-1.4.2.tar.gz（66.0 MB）'],
    ['info', 'unpack', 'tar xzf 完成'],
    ['info', 'before_switch', '$ bash bin/migrate.sh'],
    ['info', 'before_switch', 'Flyway: 2 migrations applied'],
    ['info', 'switch', 'current 已切换'],
    ['info', 'restart', '$ bash bin/restart.sh'],
    ['warn', 'health_check', 'TCP 127.0.0.1:8080 未就绪（1/10）'],
    ['warn', 'health_check', 'TCP 127.0.0.1:8080 未就绪（10/10）'],
    ['error', 'health_check', '健康检查失败，autoRollback 开启 → 切回上一版并重启'],
    ['info', 'switch', `current -> releases/${releaseNameAt(-6 * DAY, '1.4.1')}`],
    ['error', 'health_check', 'TCP 8080 在 30s 内未就绪（10 次重试），已自动回滚到上一版'],
  ]),
];

export const mockDeployReleases: DeployRelease[] = [
  { id: 1, appId: 3, appKey: 'order-svc', appName: '订单服务', targetId: 1, targetName: '生产', hostId: 1, hostName: '生产应用节点', releaseName: REL_142, version: '1.4.2', appReleaseId: 6, artifactId: 10, runId: 3, isCurrent: true, sizeBytes: 71_303_168, removedAt: null, createdAt: mockDateTimeOffset(-2 * HOUR) },
  { id: 2, appId: 3, appKey: 'order-svc', appName: '订单服务', targetId: 1, targetName: '生产', hostId: 1, hostName: '生产应用节点', releaseName: REL_141, version: '1.4.1', appReleaseId: 5, artifactId: 9, runId: 1, isCurrent: false, sizeBytes: 70_254_592, removedAt: null, createdAt: mockDateTimeOffset(-3 * DAY) },
  { id: 3, appId: 3, appKey: 'order-svc', appName: '订单服务', targetId: 2, targetName: '预发', hostId: 2, hostName: '测试节点', releaseName: REL_142_STAGING, version: '1.4.2', appReleaseId: 6, artifactId: 10, runId: 2, isCurrent: true, sizeBytes: 71_303_168, removedAt: null, createdAt: mockDateTimeOffset(-1 * DAY) },
  { id: 4, appId: 3, appKey: 'order-svc', appName: '订单服务', targetId: 2, targetName: '预发', hostId: 2, hostName: '测试节点', releaseName: releaseNameAt(-2 * DAY, '1.4.2'), version: '1.4.2', appReleaseId: 6, artifactId: 10, runId: 4, isCurrent: false, sizeBytes: 71_303_168, removedAt: null, createdAt: mockDateTimeOffset(-2 * DAY) },
  { id: 5, appId: 3, appKey: 'order-svc', appName: '订单服务', targetId: 2, targetName: '预发', hostId: 2, hostName: '测试节点', releaseName: releaseNameAt(-6 * DAY, '1.4.1'), version: '1.4.1', appReleaseId: 5, artifactId: 9, runId: null, isCurrent: false, sizeBytes: 70_254_592, removedAt: null, createdAt: mockDateTimeOffset(-6 * DAY) },
];

let nextTargetId = nextIdFrom(mockDeployTargets);
export function getNextDeployTargetId(): number {
  return nextTargetId++;
}

let nextRunId = nextIdFrom(mockDeployRuns);
export function getNextDeployRunId(): number {
  return nextRunId++;
}

let nextReleaseId = nextIdFrom(mockDeployReleases);
export function getNextDeployReleaseId(): number {
  return nextReleaseId++;
}
