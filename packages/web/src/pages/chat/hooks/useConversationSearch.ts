import { useCallback, useEffect, useMemo } from 'react';
import { Toast } from '@douyinfe/semi-ui';
import { chatContract } from '@zenith/shared/chat';
import type { ChatConversation, ChatMessage, ChatMessageContext, ChatMessageSearchItem, ChatGroupMember } from '@zenith/shared/chat';
import { api } from '@/lib/contract-query';
import { formatDateTimeRangeValuesForApi } from '@/utils/date';
import type { SearchDatePreset, Setter } from '../types';

/** 会话内消息搜索：筛选、日期预设、执行搜索、跳转定位（自 ChatPage 原样搬移） */
export function useConversationSearch({
  activeConv, activeConvId, currentUserId, currentUserNickname, messages, msgSearch,
  searchMembers, searchResults, searchSenderId, searchTimeRange, searchTypeFilters, showSearchPanel,
  scrollToMessage, setContextMode, setHasMore, setMessages, setMsgSearch, setOldestMsgId,
  setSearchDatePreset, setSearchHasSearched, setSearchLoading, setSearchMembers, setSearchPage, setSearchResults,
  setSearchSenderId, setSearchTimeRange, setSearchTotal, setSearchTypeFilters, setShowMembers, setShowSearchPanel,
}: {
  activeConv: ChatConversation | null;
  activeConvId: number | null;
  currentUserId: number | null;
  currentUserNickname: string;
  messages: ChatMessage[];
  msgSearch: string;
  searchMembers: ChatGroupMember[];
  searchResults: ChatMessageSearchItem[];
  searchSenderId: number | undefined;
  searchTimeRange: [Date, Date] | null;
  searchTypeFilters: ChatMessage['type'][];
  showSearchPanel: boolean;
  scrollToMessage: (messageId: number) => Promise<void>;
  setContextMode: Setter<{ anchorMessageId: number; keyword: string } | null>;
  setHasMore: Setter<boolean>;
  setMessages: Setter<ChatMessage[]>;
  setMsgSearch: Setter<string>;
  setOldestMsgId: Setter<number | null>;
  setSearchDatePreset: Setter<SearchDatePreset>;
  setSearchHasSearched: Setter<boolean>;
  setSearchLoading: Setter<boolean>;
  setSearchMembers: Setter<ChatGroupMember[]>;
  setSearchPage: Setter<number>;
  setSearchResults: Setter<ChatMessageSearchItem[]>;
  setSearchSenderId: Setter<number | undefined>;
  setSearchTimeRange: Setter<[Date, Date] | null>;
  setSearchTotal: Setter<number>;
  setSearchTypeFilters: Setter<ChatMessage['type'][]>;
  setShowMembers: Setter<boolean>;
  setShowSearchPanel: Setter<boolean>;
}) {
  const resetSearchFilters = useCallback(() => {
    setMsgSearch('');
    setSearchTypeFilters([]);
    setSearchSenderId(undefined);
    setSearchTimeRange(null);
    setSearchDatePreset('');
    setSearchResults([]);
    setSearchTotal(0);
    setSearchPage(1);
    setSearchHasSearched(false);
    setShowSearchPanel(false);
  }, [setMsgSearch, setSearchDatePreset, setSearchHasSearched, setSearchPage, setSearchResults, setSearchSenderId, setSearchTimeRange, setSearchTotal, setSearchTypeFilters, setShowSearchPanel]);

  const applyDatePreset = useCallback((preset: SearchDatePreset) => {
    if (!preset) {
      setSearchDatePreset('');
      setSearchTimeRange(null);
      return;
    }
    const now = new Date();
    const start = new Date(now);
    if (preset === 'today') {
      start.setHours(0, 0, 0, 0);
    } else if (preset === '7d') {
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
    } else if (preset === '30d') {
      start.setDate(start.getDate() - 29);
      start.setHours(0, 0, 0, 0);
    }
    setSearchDatePreset(preset);
    setSearchTimeRange([start, now]);
  }, [setSearchDatePreset, setSearchTimeRange]);

  const senderOptions = useMemo(() => {
    const optionMap = new Map<number, { value: number; label: string }>();
    if (currentUserId) {
      optionMap.set(currentUserId, { value: currentUserId, label: currentUserNickname || '我' });
    }
    if (activeConv?.type === 'direct' && activeConv.targetUser) {
      optionMap.set(activeConv.targetUser.id, { value: activeConv.targetUser.id, label: activeConv.targetUser.nickname });
    }
    searchMembers.forEach((member) => {
      optionMap.set(member.id, { value: member.id, label: member.nickname });
    });
    messages.forEach((message) => {
      if (message.senderId && message.senderName) {
        optionMap.set(message.senderId, { value: message.senderId, label: message.senderName });
      }
    });
    return Array.from(optionMap.values());
  }, [activeConv, currentUserId, currentUserNickname, messages, searchMembers]);

  useEffect(() => {
    if (!showSearchPanel || !activeConvId || activeConv?.type !== 'group') {
      if (!showSearchPanel) setSearchMembers([]);
      return;
    }
    void (async () => {
      const members = await api(chatContract.groupMembers, { params: { id: activeConvId } }, { silent: true }).catch(() => null);
      if (members) setSearchMembers(members);
    })();
  }, [activeConv?.type, activeConvId, setSearchMembers, showSearchPanel]);

  const executeSearch = useCallback(async (targetPage = 1) => {
    if (!activeConvId) return;

    const hasCondition = Boolean(
      msgSearch.trim()
      || searchTypeFilters.length > 0
      || searchSenderId
      || searchTimeRange,
    );
    if (!hasCondition) {
      Toast.info('请先输入关键词或设置筛选条件');
      return;
    }

    const [startAt, endAt] = formatDateTimeRangeValuesForApi(searchTimeRange);

    setSearchLoading(true);
    const result = await api(chatContract.searchMessages, {
      params: { id: activeConvId },
      query: {
        keyword: msgSearch.trim() || undefined,
        types: searchTypeFilters.length > 0 ? searchTypeFilters.join(',') : undefined,
        senderId: searchSenderId || undefined,
        startAt,
        endAt,
        page: targetPage,
        pageSize: 20,
      },
    }, { silent: true }).catch(() => null);
    setSearchLoading(false);

    if (result) {
      setShowSearchPanel(true);
      setShowMembers(false);
      setSearchHasSearched(true);
      setSearchPage(targetPage);
      setSearchResults(targetPage === 1 ? result.list : [...searchResults, ...result.list]);
      setSearchTotal(result.total);
      return;
    }

    setSearchHasSearched(false);
    setShowSearchPanel(false);
    Toast.info('服务端搜索暂不可用，已保留本地模糊过滤');
  }, [activeConvId, msgSearch, searchResults, searchSenderId, searchTimeRange, searchTypeFilters, setSearchHasSearched, setSearchLoading, setSearchPage, setSearchResults, setSearchTotal, setShowMembers, setShowSearchPanel]);

  const jumpToSearchResult = useCallback(async (item: ChatMessageSearchItem) => {
    if (!activeConvId) return;
    let context: ChatMessageContext;
    try {
      context = await api(chatContract.messageContext, {
        params: { id: activeConvId, messageId: item.message.id },
        query: { before: 15, after: 15 },
      }, { silent: true });
    } catch (err) {
      Toast.error(err instanceof Error && err.message ? err.message : '定位消息失败');
      return;
    }
    setMessages(context.list);
    setHasMore(context.hasBefore);
    setOldestMsgId(context.list[0]?.id ?? null);
    setContextMode({ anchorMessageId: context.anchorMessageId, keyword: msgSearch.trim() || item.snippet });
    setTimeout(() => scrollToMessage(context.anchorMessageId), 80);
  }, [activeConvId, msgSearch, scrollToMessage, setContextMode, setHasMore, setMessages, setOldestMsgId]);

  return { resetSearchFilters, applyDatePreset, senderOptions, executeSearch, jumpToSearchResult };
}
