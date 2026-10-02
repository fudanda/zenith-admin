import { useCallback } from 'react';
import { Toast } from '@douyinfe/semi-ui';
import type { VirtuosoHandle } from 'react-virtuoso';
import { chatContract } from '@zenith/shared/chat';
import type { ChatConversation, ChatLinkPreview, ChatMessage, ChatMessageContext, ChatMessageExtra, ChatGroupMember, SendChatMessageInput } from '@zenith/shared/chat';
import { api } from '@/lib/contract-query';
import { extractFirstUrl } from '../utils';
import { VIRTUOSO_FIRST_INDEX_BUFFER, makeProgressHandler, removeUploadingItemById } from '../utils-state';
import type { FailedMessage, PendingFile, PendingImage, Setter, UploadingItem } from '../types';

/** 发送、选图/选文件、粘贴、消息定位滚动、@提及插入、消息更新应用（自 ChatPage 原样搬移） */
export function useComposerActions({
  activeConvId, sending, setSending, input, setInput, pendingImages,
  setPendingImages, pendingFiles, setPendingFiles, saveDraft, setDraftsMap, replyTo,
  setReplyTo, selectedMentions, setSelectedMentions, fetchLinkPreview, appendMessageOnce, setFailedMessages,
  setUploadingItems, sendImageFile, sendFileMessage, setHighlightedMessageId, messages, virtuosoRef,
  firstItemIndex, setMessages, setHasMore, setOldestMsgId, setFirstItemIndex, setContextMode,
  mentionState, setMentionClosed, activeGroupMembers, currentUserId, inputRef, setPinnedMessages,
  setFavoriteMessages, setConversations,
}: {
  activeConvId: number | null;
  sending: boolean;
  setSending: Setter<boolean>;
  input: string;
  setInput: Setter<string>;
  pendingImages: PendingImage[];
  setPendingImages: Setter<PendingImage[]>;
  pendingFiles: PendingFile[];
  setPendingFiles: Setter<PendingFile[]>;
  saveDraft: (convId: number, text: string) => void;
  setDraftsMap: Setter<Record<number, string>>;
  replyTo: ChatMessage | null;
  setReplyTo: Setter<ChatMessage | null>;
  selectedMentions: Array<{ userId: number; nickname: string }>;
  setSelectedMentions: Setter<Array<{ userId: number; nickname: string }>>;
  fetchLinkPreview: (url: string) => Promise<ChatLinkPreview | null>;
  appendMessageOnce: (message: ChatMessage) => void;
  setFailedMessages: Setter<FailedMessage[]>;
  setUploadingItems: Setter<UploadingItem[]>;
  sendImageFile: (file: File, onProgress?: (percent: number) => void) => Promise<boolean>;
  sendFileMessage: (file: File, onProgress?: (percent: number) => void) => Promise<boolean>;
  setHighlightedMessageId: Setter<number | null>;
  messages: ChatMessage[];
  virtuosoRef: React.RefObject<VirtuosoHandle | null>;
  firstItemIndex: number;
  setMessages: Setter<ChatMessage[]>;
  setHasMore: Setter<boolean>;
  setOldestMsgId: Setter<number | null>;
  setFirstItemIndex: Setter<number>;
  setContextMode: Setter<{ anchorMessageId: number; keyword: string } | null>;
  mentionState: { start: number; end: number; query: string } | null;
  setMentionClosed: Setter<boolean>;
  activeGroupMembers: ChatGroupMember[];
  currentUserId: number | null;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  setPinnedMessages: Setter<ChatMessage[]>;
  setFavoriteMessages: Setter<ChatMessage[]>;
  setConversations: Setter<ChatConversation[]>;
}) {
  const handleSend = useCallback(async () => {
    if (!activeConvId || sending || (!input.trim() && pendingImages.length === 0 && pendingFiles.length === 0)) return;

    const content = input.trim();
    const imagesToSend = [...pendingImages];
    const filesToSend = [...pendingFiles];

    setInput('');
    // 清除该会话草稿
    saveDraft(activeConvId, '');
    setDraftsMap((prev) => { const next = { ...prev }; delete next[activeConvId]; return next; });
    setPendingImages([]);
    setPendingFiles([]);
    // 注意：image previewUrl 不在这里撤销，上传中 UI 仍需要；等每张图片上传完成后再撤销

    // ─── 1. 文字消息（快速，短暂 loading 发送按钮）──────────────────────────
    if (content) {
      setSending(true);
      const body: SendChatMessageInput = { content, type: 'text' };
      if (replyTo) body.replyToId = replyTo.id;
      const mentions = selectedMentions.filter((item) => content.includes(`@${item.nickname}`));
      const extra: ChatMessageExtra = mentions.length > 0 ? { mentions } : {};
      const firstUrl = extractFirstUrl(content);
      if (firstUrl) {
        const preview = await fetchLinkPreview(firstUrl);
        if (preview) extra.linkPreview = preview;
      }
      if (Object.keys(extra).length > 0) body.extra = extra;
      const sent = await api(chatContract.sendMessage, { params: { id: activeConvId }, body }).catch(() => null);
      if (sent) {
        appendMessageOnce(sent);
      } else {
        const failId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        setFailedMessages((prev) => [...prev, { id: failId, convId: activeConvId, content }]);
      }
      setSending(false);
    }

    setReplyTo(null);
    setSelectedMentions([]);

    // ─── 2. 图片/文件：立即显示上传中占位，后台非阻塞上传 ─────────────────────
    if (imagesToSend.length > 0 || filesToSend.length > 0) {
      const tempItems: UploadingItem[] = [
        ...imagesToSend.map((item) => ({
          id: `upload-img-${item.id}`,
          type: 'image' as const,
          name: item.file.name,
          size: item.file.size,
          previewUrl: item.previewUrl,
          mimeType: item.file.type || null,
          convId: activeConvId,
        })),
        ...filesToSend.map((item) => ({
          id: `upload-file-${item.id}`,
          type: 'file' as const,
          name: item.file.name,
          size: item.file.size,
          mimeType: item.file.type || null,
          convId: activeConvId,
        })),
      ];
      setUploadingItems((prev) => [...prev, ...tempItems]);

      // 后台并行上传所有图片和文件，不阻塞当前函数，不 loading 发送按钮
      void Promise.all([
        ...imagesToSend.map(async (item) => {
          const uploadId = `upload-img-${item.id}`;
          const ok = await sendImageFile(item.file, makeProgressHandler(uploadId, setUploadingItems));
          URL.revokeObjectURL(item.previewUrl);
          setUploadingItems(removeUploadingItemById(uploadId));
          return ok ? null : 'image';
        }),
        ...filesToSend.map(async (item) => {
          const uploadId = `upload-file-${item.id}`;
          const ok = await sendFileMessage(item.file, makeProgressHandler(uploadId, setUploadingItems));
          setUploadingItems(removeUploadingItemById(uploadId));
          return ok ? null : 'file';
        }),
      ]).then((results) => {
        const failedImageCount = results.filter((r) => r === 'image').length;
        const failedFileCount = results.filter((r) => r === 'file').length;
        const failedItems: string[] = [];
        if (failedImageCount > 0) failedItems.push(`${failedImageCount} 张图片`);
        if (failedFileCount > 0) failedItems.push(`${failedFileCount} 个文件`);
        if (failedItems.length > 0) Toast.error(`有 ${failedItems.join('、')}发送失败`);
      });
    }
  }, [activeConvId, appendMessageOnce, fetchLinkPreview, input, pendingFiles, pendingImages, replyTo, saveDraft, selectedMentions, sendFileMessage, sendImageFile, sending, setDraftsMap, setFailedMessages, setInput, setPendingFiles, setPendingImages, setReplyTo, setSelectedMentions, setSending, setUploadingItems]);

  const handleSelectImages = useCallback((files: File[]) => {
    const validFiles = files.filter((file) => file.type.startsWith('image/'));
    if (validFiles.length === 0) return;

    const added = validFiles.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      file,
      previewUrl: URL.createObjectURL(file),
    }));

    setPendingImages((prev) => [...prev, ...added]);
  }, [setPendingImages]);

  const handleSelectFile = useCallback((files: File[]) => {
    const nonImageFiles = files.filter((file) => !file.type.startsWith('image/'));
    const imageFiles = files.filter((file) => file.type.startsWith('image/'));

    if (nonImageFiles.length === 0 && imageFiles.length > 0) {
      Toast.info('图片请使用“选择图片”按钮发送');
      return;
    }

    if (nonImageFiles.length > 0) {
      const added = nonImageFiles.map((file) => ({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        file,
      }));
      setPendingFiles((prev) => [...prev, ...added]);
    }
  }, [setPendingFiles]);

  const handleRemovePendingImage = useCallback((id: string) => {
    setPendingImages((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((item) => item.id !== id);
    });
  }, [setPendingImages]);

  const handleRemovePendingFile = useCallback((id: string) => {
    setPendingFiles((prev) => prev.filter((item) => item.id !== id));
  }, [setPendingFiles]);

  const handleInputPaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData.items ?? []);
    const imageFiles = items
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);

    if (imageFiles.length > 0) {
      e.preventDefault();
      handleSelectImages(imageFiles);
      Toast.success(`已添加 ${imageFiles.length} 张图片`);
    }
  }, [handleSelectImages]);

  const triggerHighlight = useCallback((id: number) => {
    setHighlightedMessageId(id);
    setTimeout(() => {
      setHighlightedMessageId((curr) => (curr === id ? null : curr));
    }, 1200);
  }, [setHighlightedMessageId]);

  const scrollToMessage = useCallback(async (id: number) => {
    // 优先查看消息是否在当前加载的 messages 中
    const idx = messages.findIndex((m) => m.id === id);
    if (idx !== -1) {
      virtuosoRef.current?.scrollToIndex({ index: firstItemIndex + idx, align: 'center', behavior: 'smooth' });
      triggerHighlight(id);
      return;
    }
    // 消息不在当前加载范围内，调用 context 接口加载后再定位
    if (!activeConvId) return;
    let context: ChatMessageContext;
    try {
      context = await api(chatContract.messageContext, {
        params: { id: activeConvId, messageId: id },
        query: { before: 15, after: 15 },
      }, { silent: true });
    } catch (err) {
      Toast.error(err instanceof Error && err.message ? err.message : '定位消息失败');
      return;
    }
    setMessages(context.list);
    setHasMore(context.hasBefore);
    setOldestMsgId(context.list[0]?.id ?? null);
    setFirstItemIndex(VIRTUOSO_FIRST_INDEX_BUFFER);
    const anchorId = context.anchorMessageId;
    setContextMode({ anchorMessageId: anchorId, keyword: '' });
    setTimeout(() => {
      const anchorIdx = context.list.findIndex((m) => m.id === anchorId);
      if (anchorIdx !== -1) {
        virtuosoRef.current?.scrollToIndex({
          index: VIRTUOSO_FIRST_INDEX_BUFFER + anchorIdx,
          align: 'center',
          behavior: 'smooth',
        });
        triggerHighlight(anchorId);
      }
    }, 80);
  }, [activeConvId, firstItemIndex, messages, setContextMode, setFirstItemIndex, setHasMore, setMessages, setOldestMsgId, triggerHighlight, virtuosoRef]);

  const getReplyMessage = useCallback((id: number) => messages.find((m) => m.id === id), [messages]);

  const insertMention = useCallback((member: ChatGroupMember) => {
    if (!mentionState) return;
    const mentionText = `@${member.nickname} `;
    setInput((prev) => prev.slice(0, mentionState.start) + mentionText + prev.slice(mentionState.end));
    setMentionClosed(true);
    // 全体成员虚拟条目：记录所有真实成员为 mention
    if (member.id === -1) {
      setSelectedMentions(activeGroupMembers
        .filter((m) => m.id !== currentUserId)
        .map((m) => ({ userId: m.id, nickname: m.nickname })));
    } else {
      setSelectedMentions((prev) => prev.some((item) => item.userId === member.id)
        ? prev
        : [...prev, { userId: member.id, nickname: member.nickname }]);
    }
    requestAnimationFrame(() => {
      const nextPos = mentionState.start + mentionText.length;
      inputRef.current?.setSelectionRange(nextPos, nextPos);
      inputRef.current?.focus();
    });
  }, [activeGroupMembers, currentUserId, inputRef, mentionState, setInput, setMentionClosed, setSelectedMentions]);

  const applyMessageUpdate = useCallback((updated: ChatMessage) => {
    // 收藏是按人隔离的视角标记：WS 广播（编辑等）载荷不携带 isFavorited，
    // 此时保留本地已知的收藏状态；显式携带（收藏/取消收藏响应）则以载荷为准
    const mergeViewerFavorite = (incoming: ChatMessage, prevMsg: ChatMessage | undefined): ChatMessage =>
      incoming.extra?.isFavorited === undefined && prevMsg?.extra?.isFavorited
        ? { ...incoming, extra: { ...(incoming.extra ?? {}), isFavorited: true } }
        : incoming;

    setMessages((prev) => prev.map((item) => item.id === updated.id ? mergeViewerFavorite(updated, item) : item));
    setPinnedMessages((prev) => {
      const merged = mergeViewerFavorite(updated, prev.find((item) => item.id === updated.id));
      const next = prev.filter((item) => item.id !== updated.id);
      if (merged.extra?.isPinned) next.unshift(merged);
      return next.slice(0, 5);
    });
    setFavoriteMessages((prev) => {
      const merged = mergeViewerFavorite(updated, prev.find((item) => item.id === updated.id));
      const next = prev.filter((item) => item.id !== updated.id);
      if (merged.extra?.isFavorited) next.unshift(merged);
      return next;
    });
    setConversations((prev) => prev.map((conv) => conv.lastMessage?.id === updated.id ? { ...conv, lastMessage: updated } : conv));
  }, [setConversations, setFavoriteMessages, setMessages, setPinnedMessages]);

  return {
    handleSend, handleSelectImages, handleSelectFile, handleRemovePendingImage, handleRemovePendingFile, handleInputPaste,
    scrollToMessage, getReplyMessage, insertMention, applyMessageUpdate,
  };
}
