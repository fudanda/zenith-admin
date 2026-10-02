/**
 * 壳层通知缓存的 WebSocket 写入契约。
 *
 * 此前 `in-app-message:new` 的载荷不带 id，客户端只能把铃铛列表与未读数一并失效重拉：
 * 一次群发给 N 个在线用户 = 2N 次请求同秒到达（惊群）。现在服务端载荷即真实行，
 * 这里断言：推送写入缓存后**没有任何请求**发出，且重复投递不会重复累加未读数。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { Announcement, InAppMessage } from '@arcbase/shared/messaging';
import {
  ApiRecorder,
  createRequestMock,
  createTestQueryClient,
  createWrapper,
  getCacheEntry,
  isInvalidated,
} from '@/test-utils/query-harness';

const api = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => api) }));

import { announcementKeys } from '@/hooks/queries/announcements';
import { inAppMessageKeys } from '@/hooks/queries/in-app-messages';
import { useInAppNotifications } from './useInAppNotifications';

function message(id: number, title = `消息 ${id}`): InAppMessage {
  return {
    id, templateId: null, templateName: null, userId: 7, username: null, title, content: '正文', type: 'info',
    isRead: false, readAt: null, source: 'system', senderId: null, senderName: null, link: null, createdAt: '2026-09-14 10:00:00',
  } as InAppMessage;
}

function announcement(id: number): Announcement {
  return { id, title: `公告 ${id}`, content: '<p>正文</p>', publishStatus: 'published', publishTime: '2026-09-14 10:00:00', createdAt: '2026-09-14 10:00:00' } as Announcement;
}

const EXISTING = message(1, '已有消息');

beforeEach(() => {
  api.reset();
  api
    .on('GET', '/api/in-app-messages', { list: [EXISTING], total: 1, page: 1, pageSize: 10 })
    .on('GET', '/api/in-app-messages/unread-count', { count: 1 })
    .on('GET', '/api/announcements/published', [{ ...announcement(1), isRead: true }])
    .on('GET', '/api/announcements/unread-count', { count: 0 });
});

async function mount() {
  const qc = createTestQueryClient();
  const hook = renderHook(() => useInAppNotifications(), { wrapper: createWrapper(qc) });
  await waitFor(() => {
    expect(hook.result.current.inAppMessages).toHaveLength(1);
    expect(hook.result.current.recentAnnouncements).toHaveLength(1);
  });
  const mountedCalls = api.calls.length;
  return { qc, hook, mountedCalls };
}

describe('prependInAppMessage —— 推送直接写缓存，不回源', () => {
  it('新消息头插到铃铛列表、未读 +1、total +1，且不发任何请求', async () => {
    const { qc, hook, mountedCalls } = await mount();

    let inserted = false;
    act(() => { inserted = hook.result.current.prependInAppMessage(message(2, '新消息')); });

    expect(inserted).toBe(true);
    // 观察者通知经 notifyManager 异步调度，渲染结果要等一拍
    await waitFor(() => expect(hook.result.current.inAppMessages.map((m) => m.id)).toEqual([2, 1]));
    expect(hook.result.current.unreadCount).toBe(2);
    expect(getCacheEntry<{ total: number }>(qc, inAppMessageKeys.mine)?.total).toBe(2);
    expect(api.calls.length).toBe(mountedCalls);
    expect(isInvalidated(qc, inAppMessageKeys.mine)).toBe(false);
    expect(isInvalidated(qc, inAppMessageKeys.myUnreadCount)).toBe(false);
  });

  it('同一 id 重复投递（多标签页 / 多进程）只计一次', async () => {
    const { hook } = await mount();

    let second = true;
    act(() => {
      hook.result.current.prependInAppMessage(message(2));
      second = hook.result.current.prependInAppMessage(message(2));
    });

    expect(second).toBe(false);
    await waitFor(() => expect(hook.result.current.inAppMessages).toHaveLength(2));
    expect(hook.result.current.unreadCount).toBe(2);
  });

  it('refreshInboxLists 只标脏收件箱页的其它变体，铃铛首页缓存保持新鲜', async () => {
    const { qc, hook, mountedCalls } = await mount();

    act(() => { hook.result.current.refreshInboxLists(); });

    expect(isInvalidated(qc, inAppMessageKeys.mine)).toBe(false);
    // 收件箱页未挂载：没有任何请求
    expect(api.calls.length).toBe(mountedCalls);
  });
});

describe('applyAnnouncementEvent —— 公告推送按 id 局部更新', () => {
  it('新公告头插为未读并累加未读数；改 / 已读 / 删除按 id 更新，全程零请求', async () => {
    const { qc, hook, mountedCalls } = await mount();
    const fresh = announcement(2);

    act(() => { hook.result.current.applyAnnouncementEvent({ type: 'announcement:new', payload: fresh }); });
    await waitFor(() => expect(hook.result.current.recentAnnouncements.map((a) => [a.id, a.isRead])).toEqual([[2, false], [1, true]]));
    expect(hook.result.current.announcementUnreadCount).toBe(1);

    act(() => { hook.result.current.applyAnnouncementEvent({ type: 'announcement:updated', payload: { ...fresh, title: '公告 2（改）' } }); });
    await waitFor(() => expect(hook.result.current.recentAnnouncements[0]).toMatchObject({ id: 2, title: '公告 2（改）', isRead: false }));

    act(() => { hook.result.current.applyAnnouncementEvent({ type: 'announcement:read', payload: { id: 2 } }); });
    await waitFor(() => expect(hook.result.current.recentAnnouncements[0].isRead).toBe(true));
    expect(hook.result.current.announcementUnreadCount).toBe(0);

    act(() => { hook.result.current.applyAnnouncementEvent({ type: 'announcement:deleted', payload: { id: 2 } }); });
    await waitFor(() => expect(hook.result.current.recentAnnouncements.map((a) => a.id)).toEqual([1]));

    expect(api.calls.length).toBe(mountedCalls);
    expect(isInvalidated(qc, announcementKeys.published)).toBe(false);
    expect(isInvalidated(qc, announcementKeys.myUnreadCount)).toBe(false);
  });

  it('删除一条未读公告时未读数随之 -1，不会为负', async () => {
    const { hook } = await mount();

    act(() => { hook.result.current.applyAnnouncementEvent({ type: 'announcement:new', payload: announcement(3) }); });
    await waitFor(() => expect(hook.result.current.announcementUnreadCount).toBe(1));
    act(() => {
      hook.result.current.applyAnnouncementEvent({ type: 'announcement:deleted', payload: { id: 3 } });
      hook.result.current.applyAnnouncementEvent({ type: 'announcement:deleted', payload: { id: 999 } });
    });

    await waitFor(() => expect(hook.result.current.announcementUnreadCount).toBe(0));
    expect(hook.result.current.recentAnnouncements.map((a) => a.id)).toEqual([1]);
  });
});

describe('refetchAfterReconnect —— 断线重连补拉', () => {
  it('把推送驱动的四个查询重新拉齐', async () => {
    const { hook, mountedCalls } = await mount();

    act(() => { hook.result.current.refetchAfterReconnect(); });

    await waitFor(() => expect(api.calls.length).toBe(mountedCalls + 4));
    expect(api.calls.slice(mountedCalls).map((c) => c.url.split('?')[0]).sort()).toEqual([
      '/api/announcements/published',
      '/api/announcements/unread-count',
      '/api/in-app-messages',
      '/api/in-app-messages/unread-count',
    ]);
  });
});
