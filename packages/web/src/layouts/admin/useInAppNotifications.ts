import { useCallback, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { hashKey, useQueryClient } from '@tanstack/react-query';
import type { InAppMessage, Announcement } from '@arcbase/shared/messaging';
import type { WsMessage } from '@arcbase/shared/platform';
import {
  announcementKeys,
  useMarkMyAnnouncementRead,
  useMyAnnouncementUnreadCount,
  usePublishedAnnouncements,
} from '@/hooks/queries/announcements';
import {
  inAppMessageKeys,
  MINE_PAGE_SIZE,
  useMyInAppMessageUnreadCount,
  useMyInAppMessages,
} from '@/hooks/queries/in-app-messages';
import { chatKeys, useChatUnreadCount } from '@/hooks/queries/chat';
import { markAnnouncementRead, prependUnique } from './utils';

type PublishedAnnouncement = Announcement & { isRead: boolean };
type AnnouncementWsMessage = Extract<WsMessage, { type: `announcement:${string}` }>;

/** 顶栏铃铛最近公告与 listPublishedForUser 同上限 */
const PUBLISHED_LIMIT = 20;
const MINE_KEY_HASH = hashKey(inAppMessageKeys.mine);

/**
 * 顶栏公告 / 站内信。
 *
 * 数据全部由 TanStack Query 持有；对外仍暴露 setInAppMessages / setUnreadCount
 * 这类 setter 形状，但底层改写为 setQueryData——WebSocket 推送（useLayoutWs）
 * 因此无需改动，同时消息列表与未读数不再出现「本地 state 与缓存各存一份」。
 */
export function useInAppNotifications() {
  const queryClient = useQueryClient();
  const [announcementPopVisible, setAnnouncementPopVisible] = useState(false);
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(null);
  const [messagePopVisible, setMessagePopVisible] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<InAppMessage | null>(null);
  const recentInAppMessageRef = useRef(new Map<string, number>());

  const { data: inAppMessages = [] } = useMyInAppMessages();
  const { data: unreadCount = 0 } = useMyInAppMessageUnreadCount();
  const { data: announcementUnreadCount = 0 } = useMyAnnouncementUnreadCount();
  const { data: recentAnnouncements = [] } = usePublishedAnnouncements();
  const markAnnouncementReadMutation = useMarkMyAnnouncementRead();

  // WebSocket 推送直接写缓存，保持与既有 setState 调用形状一致
  const setInAppMessages: Dispatch<SetStateAction<InAppMessage[]>> = useCallback((update) => {
    queryClient.setQueryData<{ list: InAppMessage[]; total: number }>(inAppMessageKeys.mine, (prev) => {
      const list = prev?.list ?? [];
      const next = typeof update === 'function' ? (update as (p: InAppMessage[]) => InAppMessage[])(list) : update;
      return { list: next, total: prev?.total ?? next.length };
    });
  }, [queryClient]);

  const setUnreadCount: Dispatch<SetStateAction<number>> = useCallback((update) => {
    queryClient.setQueryData<{ count: number }>(inAppMessageKeys.myUnreadCount, (prev) => {
      const count = prev?.count ?? 0;
      return { count: typeof update === 'function' ? (update as (p: number) => number)(count) : update };
    });
  }, [queryClient]);

  const fetchInAppMessages = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: inAppMessageKeys.mine });
    void queryClient.invalidateQueries({ queryKey: inAppMessageKeys.myUnreadCount });
  }, [queryClient]);

  /**
   * WebSocket 推送的新站内信直接写入铃铛缓存（服务端载荷即真实行，不再回源）：
   * 一次群发 N 个在线用户从 2N 次请求 + 2N 次查询降为 0。返回是否为新消息（重复投递不累加未读数）。
   */
  const prependInAppMessage = useCallback((message: InAppMessage): boolean => {
    let inserted = false;
    queryClient.setQueryData<{ list: InAppMessage[]; total: number }>(inAppMessageKeys.mine, (prev) => {
      const next = prependUnique(prev?.list ?? [], message, MINE_PAGE_SIZE);
      if (!next) return prev;
      inserted = true;
      return { list: next, total: (prev?.total ?? 0) + 1 };
    });
    if (inserted) setUnreadCount((c) => c + 1);
    return inserted;
  }, [queryClient, setUnreadCount]);

  /** 收件箱页的其它分页 / 筛选变体已挂载时才重拉（默认 refetchType 'active'），铃铛首页由 prependInAppMessage 直接写入 */
  const refreshInboxLists = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: inAppMessageKeys.myLists,
      predicate: (query) => hashKey(query.queryKey) !== MINE_KEY_HASH,
    });
  }, [queryClient]);

  const fetchRecentAnnouncements = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: announcementKeys.published });
    void queryClient.invalidateQueries({ queryKey: announcementKeys.myUnreadCount });
  }, [queryClient]);

  const setAnnouncementUnreadCount = useCallback((update: (count: number) => number) => {
    queryClient.setQueryData<{ count: number }>(announcementKeys.myUnreadCount, (prev) => ({ count: Math.max(0, update(prev?.count ?? 0)) }));
  }, [queryClient]);

  /** 公告推送同样直接写缓存：新公告头插 + 未读 +1，改 / 删 / 已读按 id 局部更新，不触发任何请求 */
  const applyAnnouncementEvent = useCallback((msg: AnnouncementWsMessage) => {
    const write = (update: (prev: PublishedAnnouncement[]) => PublishedAnnouncement[] | null) => {
      let changed = false;
      queryClient.setQueryData<PublishedAnnouncement[]>(announcementKeys.published, (prev) => {
        const next = update(prev ?? []);
        if (!next) return prev;
        changed = true;
        return next;
      });
      return changed;
    };
    switch (msg.type) {
      case 'announcement:new': {
        if (write((prev) => prependUnique(prev, { ...msg.payload, isRead: false }, PUBLISHED_LIMIT))) {
          setAnnouncementUnreadCount((c) => c + 1);
        }
        break;
      }
      case 'announcement:updated':
        write((prev) => (prev.some((a) => a.id === msg.payload.id)
          ? prev.map((a) => (a.id === msg.payload.id ? { ...msg.payload, isRead: a.isRead } : a))
          : null));
        break;
      case 'announcement:deleted': {
        let wasUnread = false;
        write((prev) => {
          const target = prev.find((a) => a.id === msg.payload.id);
          if (!target) return null;
          wasUnread = !target.isRead;
          return prev.filter((a) => a.id !== msg.payload.id);
        });
        if (wasUnread) setAnnouncementUnreadCount((c) => c - 1);
        break;
      }
      case 'announcement:read': {
        // 本人标记已读的回执：变更已由 useMarkMyAnnouncementRead 的失效契约刷新，这里只对齐其它标签页的缓存
        if (write((prev) => (prev.some((a) => a.id === msg.payload.id && !a.isRead) ? markAnnouncementRead(msg.payload.id)(prev) : null))) {
          setAnnouncementUnreadCount((c) => c - 1);
        }
        break;
      }
      case 'announcement:read-all':
        write((prev) => (prev.some((a) => !a.isRead) ? prev.map((a) => (a.isRead ? a : { ...a, isRead: true })) : null));
        setAnnouncementUnreadCount(() => 0);
        break;
    }
  }, [queryClient, setAnnouncementUnreadCount]);

  /** 断线重连：期间的推送不会重放，把推送驱动的缓存一次性拉齐 */
  const refetchAfterReconnect = useCallback(() => {
    fetchInAppMessages();
    fetchRecentAnnouncements();
  }, [fetchInAppMessages, fetchRecentAnnouncements]);

  /** 已读后的气泡 / 未读数刷新由 `useMarkMyAnnouncementRead` 的失效契约负责，这里不再重复失效（重复会取消并重发在途请求） */
  const markAnnouncementAsRead = useCallback((id: number) => {
    markAnnouncementReadMutation.mutate({ params: { id } });
  }, [markAnnouncementReadMutation]);

  return {
    inAppMessages, setInAppMessages,
    unreadCount, setUnreadCount,
    announcementUnreadCount,
    announcementPopVisible, setAnnouncementPopVisible,
    recentAnnouncements,
    selectedAnnouncement, setSelectedAnnouncement,
    messagePopVisible, setMessagePopVisible,
    selectedMessage, setSelectedMessage,
    recentInAppMessageRef,
    fetchRecentAnnouncements, markAnnouncementAsRead, fetchInAppMessages,
    prependInAppMessage, refreshInboxLists, applyAnnouncementEvent, refetchAfterReconnect,
  };
}

// ─── 聊天未读数 ────────────────────────────────────────────────────────────
export function useChatUnread() {
  const queryClient = useQueryClient();
  const { data: chatUnreadCount = 0 } = useChatUnreadCount();

  const setChatUnreadCount: Dispatch<SetStateAction<number>> = useCallback((update) => {
    queryClient.setQueryData<number>(chatKeys.unreadCount, (prev) => {
      const count = prev ?? 0;
      return typeof update === 'function' ? (update as (p: number) => number)(count) : update;
    });
  }, [queryClient]);

  return { chatUnreadCount, setChatUnreadCount };
}
