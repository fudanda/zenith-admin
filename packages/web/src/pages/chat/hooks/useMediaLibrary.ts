import { useCallback, useEffect, useRef } from 'react';
import { chatContract } from '@zenith/shared/chat';
import type { ChatMessage } from '@zenith/shared/chat';
import { api } from '@/lib/contract-query';
import type { Setter } from '../types';

/** 媒体库（图片/文件/链接）分页拉取与联动刷新（自 ChatPage 原样搬移） */
export function useMediaLibrary({
  activeConvId, mediaType, showMediaPanel, setMediaHasMore, setMediaItems, setMediaLoading,
  setMediaPage,
}: {
  activeConvId: number | null;
  mediaType: 'image' | 'file' | 'link';
  showMediaPanel: boolean;
  setMediaHasMore: Setter<boolean>;
  setMediaItems: Setter<ChatMessage[]>;
  setMediaLoading: Setter<boolean>;
  setMediaPage: Setter<number>;
}) {
  // 响应归属校验：切换会话/Tab 后丢弃迟到的旧请求响应
  const scopeRef = useRef({ convId: activeConvId, type: mediaType });
  useEffect(() => { scopeRef.current = { convId: activeConvId, type: mediaType }; }, [activeConvId, mediaType]);

  const fetchMediaItems = useCallback(async (convId: number, type: 'image' | 'file' | 'link', p = 1) => {
    setMediaLoading(true);
    if (p === 1) setMediaItems([]);  // 切换 tab 时立即清空，避免旧数据短暂闪烁
    const result = await api(chatContract.searchMessages, {
      params: { id: convId },
      query: type === 'link'
        ? { types: 'text', keyword: 'http', page: p, pageSize: 30 }
        : { types: type, page: p, pageSize: 30 },
    }, { silent: true }).catch(() => null);
    if (convId !== scopeRef.current.convId || type !== scopeRef.current.type) return;
    setMediaLoading(false);
    if (result) {
      const rawCount = result.list.length;
      let items = result.list.map((item) => item.message);
      if (type === 'link') {
        items = items.filter((m) => m.extra?.linkPreview || /https?:\/\//i.test(m.content));
      }
      if (p === 1) {
        setMediaItems(items);
      } else {
        setMediaItems((prev) => [...prev, ...items]);
      }
      setMediaPage(p);
      setMediaHasMore(rawCount >= 30);
    }
  }, [setMediaHasMore, setMediaItems, setMediaLoading, setMediaPage]);

  useEffect(() => {
    if (!showMediaPanel || !activeConvId) return;
    void fetchMediaItems(activeConvId, mediaType, 1);
  }, [showMediaPanel, activeConvId, mediaType, fetchMediaItems]);

  return { fetchMediaItems };
}
