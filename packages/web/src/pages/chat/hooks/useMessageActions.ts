import { useCallback } from 'react';
import { Toast } from '@douyinfe/semi-ui';
import { chatContract } from '@zenith/shared/chat';
import type { ChatMessage, ChatMessageExtra, ChatVoteData } from '@zenith/shared/chat';
import { api } from '@/lib/contract-query';
import { confirmDelete } from '@/utils/confirm';
import { removeMessageById, removeMessagesByIds, setMessageReactions } from '../utils-state';
import type { Setter } from '../types';

/** 消息级操作：收藏/置顶/转发/删除/表情回应/投票/编辑/撤回（自 ChatPage 原样搬移） */
export function useMessageActions({
  activeConvId, messages, selectedMessageIds, recalledDrafts, forwardingMessageIds, forwardingMode,
  inputRef, applyMessageUpdate, appendMessageOnce, setInput, setSelectedMentions,
  setMultiSelectMode, setSelectedMessageIds, setForwardingMode, setForwardingMessageIds, setForwardModalVisible, setForwardViewItems,
  setForwardViewTitle, setForwardViewVisible, setMessages, setMediaItems, setReactionTargetMsgId, setReactionPickerAnchor,
  setReactionPickerVisible, setShowVoteModal, setRecalledDrafts,
}: {
  activeConvId: number | null;
  messages: ChatMessage[];
  selectedMessageIds: number[];
  recalledDrafts: Record<number, { content: string; mentions?: Array<{ userId: number; nickname: string }> }>;
  forwardingMessageIds: number[];
  forwardingMode: 'merge' | 'individual';
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  applyMessageUpdate: (message: ChatMessage) => void;
  appendMessageOnce: (message: ChatMessage) => void;
  setInput: Setter<string>;
  setSelectedMentions: Setter<Array<{ userId: number; nickname: string }>>;
  setMultiSelectMode: Setter<boolean>;
  setSelectedMessageIds: Setter<number[]>;
  setForwardingMode: Setter<'merge' | 'individual'>;
  setForwardingMessageIds: Setter<number[]>;
  setForwardModalVisible: Setter<boolean>;
  setForwardViewItems: Setter<NonNullable<ChatMessageExtra['forwardedMessages']>>;
  setForwardViewTitle: Setter<string>;
  setForwardViewVisible: Setter<boolean>;
  setMessages: Setter<ChatMessage[]>;
  setMediaItems: Setter<ChatMessage[]>;
  setReactionTargetMsgId: Setter<number | null>;
  setReactionPickerAnchor: Setter<{ top: number; right: number } | null>;
  setReactionPickerVisible: Setter<boolean>;
  setShowVoteModal: Setter<boolean>;
  setRecalledDrafts: Setter<Record<number, { content: string; mentions?: Array<{ userId: number; nickname: string }> }>>;
}) {
  const handleToggleFavorite = useCallback(async (msg: ChatMessage) => {
    const updated = await api(chatContract.favoriteMessage, {
      params: { id: msg.id },
      body: { favorite: !msg.extra?.isFavorited },
    }).catch(() => null);
    if (!updated) return;
    applyMessageUpdate(updated);
    Toast.success(updated.extra?.isFavorited ? '已收藏' : '已取消收藏');
  }, [applyMessageUpdate]);

  const handleTogglePinMessage = useCallback(async (msg: ChatMessage) => {
    const updated = await api(chatContract.pinMessage, {
      params: { id: msg.id },
      body: { pin: !msg.extra?.isPinned },
    }).catch(() => null);
    if (!updated) return;
    applyMessageUpdate(updated);
    Toast.success(updated.extra?.isPinned ? '已置顶消息' : '已取消置顶');
  }, [applyMessageUpdate]);

  const handleEditRecalled = useCallback((messageId: number) => {
    const draft = recalledDrafts[messageId];
    if (!draft) return;
    setInput(draft.content);
    setSelectedMentions(draft.mentions ?? []);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [inputRef, recalledDrafts, setInput, setSelectedMentions]);

  const handleToggleSelectMessage = useCallback((msg: ChatMessage) => {
    if (msg.isRecalled || msg.type === 'system') return;
    setMultiSelectMode(true);
    setSelectedMessageIds((prev) =>
      prev.includes(msg.id) ? prev.filter((id) => id !== msg.id) : [...prev, msg.id],
    );
  }, [setMultiSelectMode, setSelectedMessageIds]);

  const handleExitMultiSelect = useCallback(() => {
    setMultiSelectMode(false);
    setSelectedMessageIds([]);
  }, [setMultiSelectMode, setSelectedMessageIds]);

  const handleForwardSingle = useCallback((msg: ChatMessage) => {
    setForwardingMode('individual');
    setForwardingMessageIds([msg.id]);
    setForwardModalVisible(true);
  }, [setForwardModalVisible, setForwardingMessageIds, setForwardingMode]);

  const handleForwardSelected = useCallback((mode: 'merge' | 'individual') => {
    if (selectedMessageIds.length === 0) return;
    setForwardingMode(mode);
    setForwardingMessageIds([...selectedMessageIds]);
    setForwardModalVisible(true);
  }, [selectedMessageIds, setForwardModalVisible, setForwardingMessageIds, setForwardingMode]);

  const handleForwardConfirm = useCallback(async (targetIds: number[]) => {
    setForwardModalVisible(false);
    try {
      await api(chatContract.forwardMessages, {
        body: { messageIds: forwardingMessageIds, targetConversationIds: targetIds, mode: forwardingMode },
      });
      Toast.success('转发成功');
      handleExitMultiSelect();
    } catch {
      // request 层已提示
    }
    setForwardingMessageIds([]);
  }, [forwardingMessageIds, forwardingMode, handleExitMultiSelect, setForwardModalVisible, setForwardingMessageIds]);

  const handleFavoriteSelected = useCallback(async () => {
    if (selectedMessageIds.length === 0) return;
    const msgs = messages.filter((m) => selectedMessageIds.includes(m.id) && !m.extra?.isFavorited && !m.isRecalled && m.type !== 'system');
    if (msgs.length === 0) { Toast.info('所选消息已全部收藏'); return; }
    let successCount = 0;
    for (const msg of msgs) {
      const updated = await api(chatContract.favoriteMessage, { params: { id: msg.id }, body: { favorite: true } }).catch(() => null);
      if (updated) {
        applyMessageUpdate(updated);
        successCount += 1;
      }
    }
    Toast.success(`已收藏 ${successCount} 条消息`);
    handleExitMultiSelect();
  }, [selectedMessageIds, messages, applyMessageUpdate, handleExitMultiSelect]);

  const handleOpenForwardView = useCallback((items: NonNullable<ChatMessageExtra['forwardedMessages']>, title: string) => {
    setForwardViewItems(items);
    setForwardViewTitle(title);
    setForwardViewVisible(true);
  }, [setForwardViewItems, setForwardViewTitle, setForwardViewVisible]);

  const handleDeleteSingle = useCallback(async (msg: ChatMessage) => {
    try {
      await api(chatContract.batchDeleteMessages, { body: { messageIds: [msg.id] } });
    } catch {
      return;
    }
    setMessages(removeMessageById(msg.id));
    setMediaItems(removeMessageById(msg.id));
    Toast.success('已删除');
  }, [setMediaItems, setMessages]);

  const handleDeleteSelected = useCallback(async () => {
    if (selectedMessageIds.length === 0) return;
    confirmDelete({
      title: `删除已选的 ${selectedMessageIds.length} 条消息？`,
      content: '删除后仅对自己隐藏，不影响其他人。',
      okText: '删除',
      onOk: async () => {
        try {
          await api(chatContract.batchDeleteMessages, { body: { messageIds: selectedMessageIds } });
        } catch {
          return;
        }
        const deletedIds = new Set(selectedMessageIds);
        setMessages(removeMessagesByIds(deletedIds));
        setMediaItems(removeMessagesByIds(deletedIds));
        Toast.success('已删除');
        handleExitMultiSelect();
      },
    });
  }, [selectedMessageIds, setMessages, setMediaItems, handleExitMultiSelect]);

  const handleReaction = useCallback((messageId: number, emoji: string) => {
    void api(chatContract.toggleReaction, { params: { id: messageId }, body: { emoji } })
      .then((reactions) => setMessages(setMessageReactions(messageId, reactions)))
      .catch(() => undefined);
  }, [setMessages]);

  const handlePickReactionEmoji = useCallback((messageId: number, e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setReactionTargetMsgId(messageId);
    setReactionPickerAnchor({ top: rect.top, right: window.innerWidth - rect.right });
    setReactionPickerVisible(true);
  }, [setReactionPickerAnchor, setReactionPickerVisible, setReactionTargetMsgId]);

  const handleCreateVote = useCallback(async (voteData: ChatVoteData, question: string) => {
    if (!activeConvId) return;
    const sent = await api(chatContract.sendMessage, {
      params: { id: activeConvId },
      body: { content: question, type: 'vote', extra: { voteData } },
    }).catch(() => null);
    if (!sent) return;
    appendMessageOnce(sent);
    setShowVoteModal(false);
  }, [activeConvId, appendMessageOnce, setShowVoteModal]);

  const handleVoteMessage = useCallback(async (msg: ChatMessage, optionIds: string[]) => {
    const updated = await api(chatContract.vote, { params: { id: msg.id }, body: { optionIds } }).catch(() => null);
    if (updated) applyMessageUpdate(updated);
  }, [applyMessageUpdate]);

  // 编辑消息（由 MessageBubble 内联编辑回调）
  // ─── 消息编辑 ─────────────────────────────────────────────────────────────

  const handleEditMessage = useCallback(async (updatedMsg: ChatMessage) => {
    const updated = await api(chatContract.editMessage, {
      params: { id: updatedMsg.id },
      body: { content: updatedMsg.content },
    }).catch(() => null);
    if (!updated) return;
    applyMessageUpdate(updated);
    Toast.success('已修改');
  }, [applyMessageUpdate]);

  const handleRecall = useCallback(async (msg: ChatMessage) => {
    // 仅暂存草稿供「重新编辑」按钮取回：不直接覆盖输入框，避免吞掉用户正在输入的内容
    if (msg.type === 'text') {
      setRecalledDrafts((prev) => ({
        ...prev,
        [msg.id]: { content: msg.content, mentions: msg.extra?.mentions ?? undefined },
      }));
    }
    await api(chatContract.recallMessage, { params: { id: msg.id } }).catch(() => null);
  }, [setRecalledDrafts]);

  return {
    handleToggleFavorite, handleTogglePinMessage, handleEditRecalled, handleToggleSelectMessage, handleExitMultiSelect, handleForwardSingle,
    handleForwardSelected, handleForwardConfirm, handleFavoriteSelected, handleOpenForwardView, handleDeleteSingle, handleDeleteSelected,
    handleReaction, handlePickReactionEmoji, handleCreateVote, handleVoteMessage, handleEditMessage, handleRecall,
  };
}
