/**
 * positions 域缓存一致性契约（S1 机制试点）
 *
 * 选它做首个试点，因为它在一个仅 3 处 `.all` 的小文件里同时覆盖三类规则：
 *  1. 写接口返回完整实体 → 回填 detail（服务端 create/update/get 同为 mapPosition，形状一致）
 *  2. 子资源写入返回 null → 只动关联键，但**列表渲染了 userCount/userPreview**，故仍须失效 lists
 *  3. 跨页共享 lookup（useAllPositions 被 UsersPage 使用）→ 改名/停用后必须回源
 *
 * 断言落在请求数、fetching 转换与缓存内容上，不 spy「调了哪个 key」——
 * `positionKeys.all` 是 `detail` 的前缀，spy 式断言无法区分冗余现状与改坏后的实现。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { Position } from '@arcbase/shared/identity';
import {
  ApiRecorder,
  createRequestMock,
  createTestQueryClient,
  createWrapper,
  getCacheEntry,
  hasCacheEntry,
  isFresh,
  observeFetches,
} from '@/test-utils/query-harness';

const api = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => api) }));

import {
  positionKeys,
  useAllPositions,
  useAssignPositionMembers,
  useDeletePositions,
  usePositionDetail,
  usePositionList,
  usePositionMembers,
  useSavePosition,
} from './positions';

const LIST_PARAMS = { page: 1, pageSize: 10 };

/** 详情接口形状：服务端 mapPosition，不含 userCount / userPreview */
const DETAIL: Position = {
  id: 1,
  name: '工程师',
  code: 'ENG',
  sort: 1,
  status: 'enabled',
  createdAt: '2026-07-31 10:00:00',
  updatedAt: '2026-07-31 10:00:00',
};

/** 列表接口形状：额外注入成员统计 */
const LIST_ROW: Position = { ...DETAIL, userCount: 2, userPreview: [{ id: 7, nickname: '张三' }] };

beforeEach(() => {
  api.reset();
  api
    .on('GET', '/api/positions', { list: [LIST_ROW], total: 1, page: 1, pageSize: 10 })
    .on('GET', '/api/positions/all', [DETAIL])
    .on('GET', '/api/positions/1', DETAIL)
    .on('GET', '/api/positions/1/members', [{ id: 7 }])
    .on('PUT', '/api/positions/1/members', null)
    .on('PUT', '/api/positions/1', { ...DETAIL, name: '高级工程师' })
    .on('POST', '/api/positions', { ...DETAIL, id: 2, name: '架构师' })
    .on('DELETE', '/api/positions/1', null);
});

describe('useSavePosition', () => {
  it('writes the server response straight into the detail cache instead of triggering a detail refetch', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({ detail: usePositionDetail(1), save: useSavePosition() }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => expect(result.current.detail.isSuccess).toBe(true));

    const fetches = observeFetches(qc);
    api.resetCalls();

    await result.current.save.mutateAsync({ id: 1, values: { name: '高级工程师' } });

    // 详情已由响应回填，不应再产生一次 GET /api/positions/1
    expect(getCacheEntry<Position>(qc, positionKeys.detail(1))?.name).toBe('高级工程师');
    expect(api.countOf('GET', '/api/positions/1')).toBe(0);
    expect(fetches.countOf(positionKeys.detail(1))).toBe(0);

    fetches.stop();
  });

  it('refreshes the cross-page allPositions lookup because renaming changes what the dropdown renders', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({ lookup: useAllPositions(), save: useSavePosition() }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => expect(result.current.lookup.isSuccess).toBe(true));

    api.resetCalls();
    await result.current.save.mutateAsync({ id: 1, values: { name: '高级工程师' } });
    await waitFor(() => expect(api.countOf('GET', '/api/positions/all')).toBe(1));
  });
});

describe('useAssignPositionMembers', () => {
  it('refreshes the member sheet and the list (which renders userCount/userPreview) but nothing else', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({
        list: usePositionList(LIST_PARAMS),
        detail: usePositionDetail(1),
        lookup: useAllPositions(),
        members: usePositionMembers(1),
        assign: useAssignPositionMembers(),
      }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.list.isSuccess).toBe(true);
      expect(result.current.detail.isSuccess).toBe(true);
      expect(result.current.lookup.isSuccess).toBe(true);
      expect(result.current.members.isSuccess).toBe(true);
    });

    const fetches = observeFetches(qc);
    api.resetCalls();

    await result.current.assign.mutateAsync({ params: { id: 1 }, body: { userIds: [7, 8] } });
    await waitFor(() => expect(fetches.countOf(positionKeys.members(1))).toBe(1));
    await waitFor(() => expect(result.current.list.isFetching).toBe(false));

    // 必须刷新：成员本身 + 列表的成员列
    expect(fetches.countOf(positionKeys.lists)).toBe(1);
    // 不得波及：详情与下拉源都不含成员字段（收敛前这两个会被 `.all` 一并打掉）
    expect(fetches.countOf(positionKeys.detail(1))).toBe(0);
    expect(fetches.countOf(positionKeys.allPositions)).toBe(0);
    expect(isFresh(qc, positionKeys.detail(1))).toBe(true);
    expect(isFresh(qc, positionKeys.allPositions)).toBe(true);
    expect(api.countOf('GET', '/api/positions/all')).toBe(0);
    expect(api.countOf('GET', '/api/positions/1')).toBe(0);

    fetches.stop();
  });
});

describe('useDeletePositions', () => {
  it('drops the deleted entity caches instead of invalidating them into guaranteed 404 refetches', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({
        list: usePositionList(LIST_PARAMS),
        remove: useDeletePositions(),
      }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));

    // 详情/成员是弹窗关闭后遗留的缓存：有数据但无 observer，正是删除时最容易被误失效的对象
    qc.setQueryData(positionKeys.detail(1), DETAIL);
    qc.setQueryData(positionKeys.members(1), [{ id: 7 }]);
    api.resetCalls();

    await result.current.remove.mutateAsync([1]);
    await waitFor(() => expect(result.current.list.isFetching).toBe(false));

    expect(hasCacheEntry(qc, positionKeys.detail(1))).toBe(false);
    expect(hasCacheEntry(qc, positionKeys.members(1))).toBe(false);
    expect(api.countOf('GET', '/api/positions/1')).toBe(0);
    expect(api.countOf('GET', '/api/positions')).toBe(1);
  });
});
