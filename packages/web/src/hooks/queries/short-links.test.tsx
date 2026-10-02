/**
 * short-links 域缓存一致性契约
 *
 * 两个关注点：
 *  1. 批量启用/禁用是非标准 mutation：必须刷新列表与被操作详情；
 *  2. 访问统计（short-link-stats）是独立命名空间的昂贵派生查询：
 *     任何列表侧写操作都不应把它打回源。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ShortLink, ShortLinkStats } from '@arcbase/shared/short-link';
import {
  ApiRecorder,
  createRequestMock,
  createTestQueryClient,
  createWrapper,
  isFresh,
  observeFetches,
} from '@/test-utils/query-harness';

const api = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => api) }));

import {
  shortLinkKeys,
  shortLinkStatsKeys,
  useBatchUpdateShortLinkStatus,
  useSaveShortLink,
  useShortLinkDetail,
  useShortLinkList,
  useShortLinkStats,
} from './short-links';

const LIST_PARAMS = { page: 1, pageSize: 10 };

const LINK: ShortLink = {
  id: 1,
  code: 'welcome',
  shortUrl: 'http://localhost:3300/s/welcome',
  targetUrl: 'https://www.example.com/campaign/landing',
  title: '演示活动落地页',
  redirectType: '302',
  status: 'enabled',
  expiresAt: null,
  expired: false,
  maxVisits: null,
  password: null,
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  utmTerm: null,
  utmContent: null,
  bizType: 'custom',
  bizRef: null,
  remark: null,
  totalPv: 10,
  lastVisitAt: null,
  createdAt: '2026-08-01 10:00:00',
  updatedAt: '2026-08-01 10:00:00',
};

const STATS: ShortLinkStats = {
  totals: { pv: 10, uv: 6, todayPv: 2, todayUv: 1 },
  trend: [{ date: '2026-08-01', pv: 10, uv: 6 }],
  devices: [],
  browsers: [],
  regions: [],
  referers: [],
};

beforeEach(() => {
  api.reset();
  api
    .on('GET', '/api/short-links', { list: [LINK], total: 1, page: 1, pageSize: 10 })
    .on('GET', '/api/short-links/1/stats', STATS)
    .on('GET', '/api/short-links/1', LINK)
    .on('PUT', '/api/short-links/1', { ...LINK, title: '改名' })
    .on('PUT', '/api/short-links/batch/status', null);
});

function mountPage() {
  const qc = createTestQueryClient();
  const hook = renderHook(
    () => ({
      list: useShortLinkList(LIST_PARAMS),
      detail: useShortLinkDetail(1),
      stats: useShortLinkStats(1, 30),
      save: useSaveShortLink(),
      batchStatus: useBatchUpdateShortLinkStatus(),
    }),
    { wrapper: createWrapper(qc) },
  );
  return { qc, hook };
}

async function settle(hook: ReturnType<typeof mountPage>['hook']) {
  await waitFor(() => {
    expect(hook.result.current.list.isSuccess).toBe(true);
    expect(hook.result.current.detail.isSuccess).toBe(true);
    expect(hook.result.current.stats.isSuccess).toBe(true);
  });
}

describe('useBatchUpdateShortLinkStatus —— 非标准批量接口', () => {
  it('refreshes the list and each affected detail, but not the stats namespace', async () => {
    const { qc, hook } = mountPage();
    await settle(hook);

    const fetches = observeFetches(qc);
    api.resetCalls();

    await hook.result.current.batchStatus.mutateAsync({ body: { ids: [1], status: 'disabled' } });
    await waitFor(() => expect(hook.result.current.list.isFetching).toBe(false));

    expect(fetches.countOf(shortLinkKeys.lists)).toBe(1);
    expect(fetches.countOf(shortLinkKeys.detail(1))).toBe(1);
    // 统计是独立命名空间：状态切换不应触发它回源
    expect(fetches.countOf(shortLinkStatsKeys.all)).toBe(0);
    expect(isFresh(qc, shortLinkStatsKeys.stats(1, 30))).toBe(true);

    fetches.stop();
  });
});

describe('useSaveShortLink —— 工厂契约下统计保持独立', () => {
  it('leaves the stats query untouched when editing basic fields', async () => {
    const { qc, hook } = mountPage();
    await settle(hook);

    const fetches = observeFetches(qc);
    api.resetCalls();

    await hook.result.current.save.mutateAsync({ id: 1, values: { title: '改名' } });
    await waitFor(() => expect(hook.result.current.list.isFetching).toBe(false));

    expect(fetches.countOf(shortLinkKeys.lists)).toBe(1);
    expect(fetches.countOf(shortLinkKeys.detail(1))).toBe(1);
    expect(fetches.countOf(shortLinkStatsKeys.all)).toBe(0);
    expect(api.countOf('GET', '/api/short-links/1/stats')).toBe(0);

    fetches.stop();
  });
});
