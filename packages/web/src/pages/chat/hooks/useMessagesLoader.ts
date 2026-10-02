import { useCallback, useEffect } from 'react';
import { chatContract } from '@arcbase/shared/chat';
import type { ChatMessage } from '@arcbase/shared/chat';
import { api } from '@/lib/contract-query';
import { VIRTUOSO_FIRST_INDEX_BUFFER } from '../utils-state';
import type { Setter } from '../types';

/** 收藏列表联动加载 + 消息分页加载 fetchMessages（自 ChatPage 原样搬移） */
export function useMessagesLoader({
  leftPaneMode, fetchFavoriteMessages, setLoadingMsgs, setMessages, setOldestMsgId, setFirstItemIndex,
  setPendingNewMsgCount, setContextMode, setHasMore,
}: {
  leftPaneMode: 'conversations' | 'favorites' | 'globalSearch';
  fetchFavoriteMessages: () => Promise<void>;
  setLoadingMsgs: Setter<boolean>;
  setMessages: Setter<ChatMessage[]>;
  setOldestMsgId: Setter<number | null>;
  setFirstItemIndex: Setter<number>;
  setPendingNewMsgCount: Setter<number>;
  setContextMode: Setter<{ anchorMessageId: number; keyword: string } | null>;
  setHasMore: Setter<boolean>;
}) {
  useEffect(() => {
    if (leftPaneMode === 'favorites') {
      void fetchFavoriteMessages();
    }
  }, [fetchFavoriteMessages, leftPaneMode]);

  const fetchMessages = useCallback(async (convId: number, beforeId?: number): Promise<ChatMessage[] | null> => {
    setLoadingMsgs(true);
    const page = await api(chatContract.messages, {
      params: { id: convId },
      query: { limit: 30, ...(beforeId ? { beforeId } : {}) },
    }, { silent: true }).catch(() => null);
    setLoadingMsgs(false);
    if (page) {
      const newMsgs = [...page.list].reverse(); // backend returns newest-first, reverse to oldest-first
      if (beforeId) {
        setMessages((prev) => [...newMsgs, ...prev]);
        setOldestMsgId(newMsgs[0]?.id ?? null);
        // Virtuoso 通过 firstItemIndex 向前偏移来保持当前视口位置不跳动
        setFirstItemIndex((prev) => prev - newMsgs.length);
      } else {
        setMessages(newMsgs);
        setOldestMsgId(newMsgs[0]?.id ?? null);
        setPendingNewMsgCount(0);
        setContextMode(null);
        setFirstItemIndex(VIRTUOSO_FIRST_INDEX_BUFFER);
      }
      setHasMore(page.hasMore);
      return newMsgs;
    }
    return null;
  }, [setContextMode, setFirstItemIndex, setHasMore, setLoadingMsgs, setMessages, setOldestMsgId, setPendingNewMsgCount]);

  return { fetchMessages };
}
