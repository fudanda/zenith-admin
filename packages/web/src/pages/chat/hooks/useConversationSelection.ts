import { useCallback } from 'react';
import type { VirtuosoHandle } from 'react-virtuoso';
import { chatContract } from '@zenith/shared/chat';
import type { ChatConversation, ChatMessage, ChatMessageSearchItem } from '@zenith/shared/chat';
import { api } from '@/lib/contract-query';
import type { ChatUser, PendingFile, PendingImage, SearchDatePreset, Setter } from '../types';

/** 会话切换 / 新建单聊 / 建群回调 / 消息去重追加（自 ChatPage 原样搬移） */
export function useConversationSelection({
  activeConvId, input, currentUserId, onConvChange, saveDraft, loadDraft,
  fetchMessages, fetchConversations, virtuosoRef, showMediaPanelRef, mediaTypeRef, activeConvIdRef,
  setActiveConvId, setActiveChannelId, setReplyTo, setSelectedMentions, setPendingImages, setPendingFiles,
  setLeftPaneMode, setAnnouncementHistoryVisible, setShowMembers, setShowSearchPanel, setMsgSearch, setSearchTypeFilters,
  setSearchSenderId, setSearchTimeRange, setSearchDatePreset, setSearchResults, setSearchTotal, setSearchPage,
  setSearchHasSearched, setContextMode, setShowMediaPanel, setMediaItems, setMediaPage, setMediaHasMore,
  setInput, setUnreadDivider, setConversations, setShowNewChat, setMessages,
}: {
  activeConvId: number | null;
  input: string;
  currentUserId: number | null;
  onConvChange: ((convId: number | null) => void) | undefined;
  saveDraft: (convId: number, text: string) => void;
  loadDraft: (convId: number) => string;
  fetchMessages: (convId: number, beforeId?: number) => Promise<ChatMessage[] | null>;
  fetchConversations: () => Promise<void>;
  virtuosoRef: React.RefObject<VirtuosoHandle | null>;
  showMediaPanelRef: React.RefObject<boolean>;
  mediaTypeRef: React.RefObject<'image' | 'file' | 'link'>;
  activeConvIdRef: React.RefObject<number | null>;
  setActiveConvId: Setter<number | null>;
  setActiveChannelId: Setter<number | null>;
  setReplyTo: Setter<ChatMessage | null>;
  setSelectedMentions: Setter<Array<{ userId: number; nickname: string }>>;
  setPendingImages: Setter<PendingImage[]>;
  setPendingFiles: Setter<PendingFile[]>;
  setLeftPaneMode: Setter<'conversations' | 'favorites' | 'globalSearch'>;
  setAnnouncementHistoryVisible: Setter<boolean>;
  setShowMembers: Setter<boolean>;
  setShowSearchPanel: Setter<boolean>;
  setMsgSearch: Setter<string>;
  setSearchTypeFilters: Setter<ChatMessage['type'][]>;
  setSearchSenderId: Setter<number | undefined>;
  setSearchTimeRange: Setter<[Date, Date] | null>;
  setSearchDatePreset: Setter<SearchDatePreset>;
  setSearchResults: Setter<ChatMessageSearchItem[]>;
  setSearchTotal: Setter<number>;
  setSearchPage: Setter<number>;
  setSearchHasSearched: Setter<boolean>;
  setContextMode: Setter<{ anchorMessageId: number; keyword: string } | null>;
  setShowMediaPanel: Setter<boolean>;
  setMediaItems: Setter<ChatMessage[]>;
  setMediaPage: Setter<number>;
  setMediaHasMore: Setter<boolean>;
  setInput: Setter<string>;
  setUnreadDivider: Setter<{ convId: number; messageId: number } | null>;
  setConversations: Setter<ChatConversation[]>;
  setShowNewChat: Setter<boolean>;
  setMessages: Setter<ChatMessage[]>;
}) {
  const handleSelectConv = useCallback(async (conv: ChatConversation) => {
    // 保存当前会话草稿
    if (activeConvId) saveDraft(activeConvId, input);
    setActiveConvId(conv.id);
    setActiveChannelId(null);
    onConvChange?.(conv.id);
    setReplyTo(null);
    setSelectedMentions([]);
    setPendingImages([]);
    setPendingFiles([]);
    setLeftPaneMode('conversations');
    setAnnouncementHistoryVisible(false);
    setShowMembers(false);
    setShowSearchPanel(false);
    setMsgSearch('');
    setSearchTypeFilters([]);
    setSearchSenderId(undefined);
    setSearchTimeRange(null);
    setSearchDatePreset('');
    setSearchResults([]);
    setSearchTotal(0);
    setSearchPage(1);
    setSearchHasSearched(false);
    setContextMode(null);
    setShowMediaPanel(false);
    setMediaItems([]);
    setMediaPage(1);
    setMediaHasMore(false);
    // 恢复目标会话草稿
    setInput(loadDraft(conv.id));
    const loaded = await fetchMessages(conv.id);
    // 定位未读分隔线：unreadCount 只统计他人消息，从尾部倒推
    if (conv.unreadCount > 0 && loaded && loaded.length > 0) {
      let remaining = conv.unreadCount;
      let anchorId: number | null = null;
      for (let i = loaded.length - 1; i >= 0; i--) {
        if (loaded[i].senderId !== currentUserId && loaded[i].senderId !== null) {
          remaining--;
          if (remaining === 0) { anchorId = loaded[i].id; break; }
        }
      }
      // 未读数超出本页加载范围时，退化为标记在最早一条
      setUnreadDivider({ convId: conv.id, messageId: anchorId ?? loaded[0].id });
    } else {
      setUnreadDivider(null);
    }
    await api(chatContract.markRead, { params: { id: conv.id } }, { silent: true }).catch(() => null);
    setConversations((prev) => prev.map((c) => c.id === conv.id ? { ...c, unreadCount: 0, hasMentionUnread: false } : c));
    setTimeout(() => virtuosoRef.current?.scrollToIndex({ index: 'LAST', behavior: 'smooth' }), 100);
  }, [activeConvId, currentUserId, fetchMessages, input, loadDraft, onConvChange, saveDraft, setActiveChannelId, setActiveConvId, setAnnouncementHistoryVisible, setContextMode, setConversations, setInput, setLeftPaneMode, setMediaHasMore, setMediaItems, setMediaPage, setMsgSearch, setPendingFiles, setPendingImages, setReplyTo, setSearchDatePreset, setSearchHasSearched, setSearchPage, setSearchResults, setSearchSenderId, setSearchTimeRange, setSearchTotal, setSearchTypeFilters, setSelectedMentions, setShowMediaPanel, setShowMembers, setShowSearchPanel, setUnreadDivider, virtuosoRef]);

  const handleNewDirectChat = useCallback(async (user: ChatUser) => {
    setShowNewChat(false);
    const conv = await api(chatContract.createDirect, { body: { targetUserId: user.id } }).catch(() => null);
    if (conv) {
      await fetchConversations();
      await handleSelectConv(conv);
    }
  }, [fetchConversations, handleSelectConv, setShowNewChat]);

  const handleGroupCreated = useCallback(async (conv: ChatConversation) => {
    setShowNewChat(false);
    await fetchConversations();
    await handleSelectConv(conv);
  }, [fetchConversations, handleSelectConv, setShowNewChat]);

  const appendMessageOnce = useCallback((message: ChatMessage) => {
    setMessages((prev) => (prev.some((item) => item.id === message.id) ? prev : [...prev, message]));
    if (!showMediaPanelRef.current || message.conversationId !== activeConvIdRef.current) return;
    const type = mediaTypeRef.current;
    const isMediaMatch =
      (type === 'image' && message.type === 'image') ||
      (type === 'file' && message.type === 'file') ||
      (type === 'link' && message.type === 'text' && (message.extra?.linkPreview || /https?:\/\//i.test(message.content)));
    if (isMediaMatch) setMediaItems((prev) => (prev.some((m) => m.id === message.id) ? prev : [message, ...prev]));
  }, [activeConvIdRef, mediaTypeRef, setMediaItems, setMessages, showMediaPanelRef]);

  return { handleSelectConv, handleNewDirectChat, handleGroupCreated, appendMessageOnce };
}
