/**
 * 应用部署 Mock（Demo 模式）：部署目标 CRUD、部署记录 / 日志、发布目录列表。
 * 发起部署 / 回滚 / 对账等执行类端点随引擎在后续里程碑补齐。
 */
import {
  deployReleaseContract,
  deployRunContract,
  deployTargetContract,
  type DeployTarget,
  type DeployTargetHost,
} from '@arcbase/shared/ops';
import { mock } from '@/mocks/utils/contract';
import { requireItem } from '@/mocks/utils/crud';
import { mockDateTime } from '@/mocks/utils/date';
import { badRequest } from '@/mocks/utils/handlers';
import { filterByKeyword, matchesFilter, withinDateRange } from '@/mocks/utils/filter';
import { mockClientApps } from '../data/app-releases';
import { getNextDeployTargetId, mockDeployReleases, mockDeployRunHosts, mockDeployRunLogs, mockDeployRuns, mockDeployTargets } from '../data/deploy';

/** 主机基本信息与 ops-hosts mock 对齐（那边的数组是模块私有，这里只需展示字段） */
const MOCK_HOSTS: Record<number, { hostName: string; host: string }> = {
  1: { hostName: '生产应用节点', host: '10.0.10.21' },
  2: { hostName: '测试节点', host: '10.0.20.31' },
};

function hostsFromIds(hostIds: number[], existing: DeployTargetHost[] = []): DeployTargetHost[] {
  return hostIds.map((hostId, order) => {
    const keep = existing.find((h) => h.hostId === hostId);
    const info = MOCK_HOSTS[hostId] ?? { hostName: `主机 #${hostId}`, host: '10.0.0.0' };
    return {
      hostId, order, hostEnabled: true, ...info,
      currentVersion: keep?.currentVersion ?? null,
      currentReleaseName: keep?.currentReleaseName ?? null,
      currentSince: keep?.currentSince ?? null,
    };
  });
}

export const deployHandlers = [
  // ─── 部署目标 ──────────────────────────────────────────────────────────────
  mock(deployTargetContract.list, ({ query, ok }) => {
    let list = mockDeployTargets;
    if (query.appId !== undefined) list = list.filter((t) => t.appId === query.appId);
    if (query.enabled !== undefined) list = list.filter((t) => t.enabled === query.enabled);
    if (query.keyword) list = filterByKeyword(list, query.keyword, [(t) => t.name, (t) => t.appName ?? '', (t) => t.appKey ?? '']);
    return ok(list);
  }),

  mock(deployTargetContract.detail, ({ params, ok }) => ok(requireItem(mockDeployTargets, params.id, '部署目标不存在', { status: 404 }))),

  mock(deployTargetContract.create, ({ body, ok }) => {
    const app = mockClientApps.find((a) => a.id === body.appId);
    if (!app) return badRequest('应用不存在');
    if (app.kind !== 'service') return badRequest('只有服务端应用（kind = service）可以配置部署目标');
    if (mockDeployTargets.some((t) => t.appId === body.appId && t.name === body.name)) return badRequest('该应用下已存在同名部署目标');
    const now = mockDateTime();
    const { hostIds, ...rest } = body;
    const target: DeployTarget = {
      id: getNextDeployTargetId(),
      ...rest,
      appKey: app.appKey,
      appName: app.name,
      description: rest.description ?? null,
      serviceName: rest.serviceName ?? null,
      remark: rest.remark ?? null,
      scripts: { beforeSwitch: rest.scripts.beforeSwitch ?? null, restart: rest.scripts.restart ?? null },
      healthCheck: { ...rest.healthCheck, url: rest.healthCheck.url ?? null, port: rest.healthCheck.port ?? null, command: rest.healthCheck.command ?? null },
      hosts: hostsFromIds(hostIds),
      lastRun: null,
      createdAt: now,
      updatedAt: now,
    };
    mockDeployTargets.push(target);
    return ok(target, '已创建');
  }),

  mock(deployTargetContract.update, ({ params, body, ok }) => {
    const target = requireItem(mockDeployTargets, params.id, '部署目标不存在', { status: 404 });
    const { hostIds, scripts, healthCheck, ...rest } = body;
    Object.assign(target, Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)));
    if (scripts) target.scripts = { beforeSwitch: scripts.beforeSwitch ?? null, restart: scripts.restart ?? null };
    if (healthCheck) target.healthCheck = { ...healthCheck, url: healthCheck.url ?? null, port: healthCheck.port ?? null, command: healthCheck.command ?? null };
    if (hostIds) target.hosts = hostsFromIds(hostIds, target.hosts);
    target.updatedAt = mockDateTime();
    return ok(target, '已更新');
  }),

  mock(deployTargetContract.remove, ({ params, ok }) => {
    const target = requireItem(mockDeployTargets, params.id, '部署目标不存在', { status: 404 });
    if (mockDeployRuns.some((r) => r.targetId === target.id && (r.status === 'pending' || r.status === 'running'))) {
      return badRequest('该目标有进行中的部署，请等待结束后再删除');
    }
    mockDeployTargets.splice(mockDeployTargets.indexOf(target), 1);
    return ok(null, '已删除');
  }),

  // ─── 部署记录 ──────────────────────────────────────────────────────────────
  mock(deployRunContract.list, ({ query, ok, paginate }) => {
    let list = [...mockDeployRuns].sort((a, b) => b.id - a.id);
    if (query.appId !== undefined) list = list.filter((r) => r.appId === query.appId);
    if (query.targetId !== undefined) list = list.filter((r) => r.targetId === query.targetId);
    list = list.filter((r) => matchesFilter(r.kind, query.kind) && matchesFilter(r.status, query.status));
    if (query.keyword) list = filterByKeyword(list, query.keyword, [(r) => r.version ?? '', (r) => r.remark ?? '', (r) => r.releaseName ?? '']);
    list = list.filter((r) => withinDateRange(r.createdAt, query.startTime, query.endTime));
    return ok(paginate(list.map(({ snapshot: _s, hosts: _h, ...brief }) => brief)));
  }),

  mock(deployRunContract.detail, ({ params, ok }) => {
    const run = requireItem(mockDeployRuns, params.id, '部署记录不存在', { status: 404 });
    return ok({ ...run, hosts: mockDeployRunHosts.filter((h) => h.runId === run.id) });
  }),

  mock(deployRunContract.logs, ({ params, query, ok }) => {
    requireItem(mockDeployRuns, params.id, '部署记录不存在', { status: 404 });
    let list = mockDeployRunLogs.filter((l) => l.runId === params.id && l.seq > query.afterSeq);
    if (query.hostId !== undefined) list = list.filter((l) => l.hostId === null || l.hostId === query.hostId);
    return ok(list.sort((a, b) => a.seq - b.seq).slice(0, query.limit));
  }),

  // ─── 发布目录（还原点）───────────────────────────────────────────────────
  mock(deployReleaseContract.list, ({ query, ok, paginate }) => {
    let list = mockDeployReleases;
    if (query.appId !== undefined) list = list.filter((r) => r.appId === query.appId);
    if (query.targetId !== undefined) list = list.filter((r) => r.targetId === query.targetId);
    if (query.hostId !== undefined) list = list.filter((r) => r.hostId === query.hostId);
    if (!query.includeRemoved) list = list.filter((r) => r.removedAt === null);
    if (query.keyword) list = filterByKeyword(list, query.keyword, [(r) => r.version, (r) => r.releaseName]);
    const sorted = [...list].sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || b.releaseName.localeCompare(a.releaseName));
    return ok(paginate(sorted));
  }),
];
