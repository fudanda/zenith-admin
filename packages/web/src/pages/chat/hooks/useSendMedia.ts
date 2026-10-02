import { useCallback } from 'react';
import { useThrottledCallback } from '@tanstack/react-pacer';
import { Toast } from '@douyinfe/semi-ui';
import { chatContract } from '@arcbase/shared/chat';
import { fileContract, type ManagedFile } from '@arcbase/shared/platform';
import { api, urlOf } from '@/lib/contract-query';
import { request } from '@/utils/request';
import { sendWsMessage } from '@/hooks/useWebSocket';
import { useAddChatCustomEmoji } from '@/hooks/queries/chat';
import type { ChatAssetMeta, ChatCustomEmoji, ChatLinkPreview, ChatMessage } from '@arcbase/shared/chat';
import { getFileExtension, getImageDimensions } from '../utils';
import type { Setter } from '../types';
import { useVoiceRecorder } from '../useVoiceRecorder';

/** 文件/图片/贴纸/语音发送、正在输入节流、链接预览抓取（自 ChatPage 原样搬移） */
export function useSendMedia({
  activeConvId, currentUserId, currentUserNickname, appendMessageOnce, addEmojiMutation,
  setEmojiVisible,
}: {
  activeConvId: number | null;
  currentUserId: number | null;
  currentUserNickname: string;
  appendMessageOnce: (message: ChatMessage) => void;
  addEmojiMutation: ReturnType<typeof useAddChatCustomEmoji>;
  setEmojiVisible: Setter<boolean>;
}) {
  const sendFileMessage = useCallback(async (file: File, onProgress?: (percent: number) => void) => {
    if (!activeConvId) return false;
    const fd = new FormData();
    fd.append('file', file);
    const uploadRes = await request.postForm<ManagedFile>(urlOf(fileContract.uploadOne), fd, { onProgress, silent: true });
    if (uploadRes.code !== 0 || !uploadRes.data) return false;
    const { id: fileId, url, originalName, size } = uploadRes.data;
    // 视频文件走 video 消息类型（内联播放），其余为普通文件
    const isVideo = (file.type || '').startsWith('video/');
    const asset: ChatAssetMeta = {
      kind: isVideo ? 'video' : 'file',
      name: originalName,
      size,
      mimeType: file.type || null,
      extension: getFileExtension(originalName),
      fileId,
    };
    const msg = await api(chatContract.sendMessage, {
      params: { id: activeConvId },
      body: { content: url, type: isVideo ? 'video' : 'file', extra: { asset } },
    }, { silent: true }).catch(() => null);
    if (msg) appendMessageOnce(msg);
    return Boolean(msg);
  }, [activeConvId, appendMessageOnce]);

  // 发送收藏表情（作为图片消息）
  const sendSticker = useCallback(async (emoji: ChatCustomEmoji) => {
    if (!activeConvId) return;
    const asset: ChatAssetMeta = {
      kind: 'image',
      name: emoji.name ?? '表情',
      size: 0,
      mimeType: null,
      extension: null,
      fileId: emoji.fileId,
      width: emoji.width,
      height: emoji.height,
      thumbnailUrl: emoji.url,
    };
    const msg = await api(chatContract.sendMessage, {
      params: { id: activeConvId },
      body: { content: emoji.url, type: 'image', extra: { asset } },
    }).catch(() => null);
    if (msg) appendMessageOnce(msg);
    setEmojiVisible(false);
  }, [activeConvId, appendMessageOnce, setEmojiVisible]);

  // 图片消息 → 收藏为自定义表情
  const handleSaveAsEmoji = useCallback((msg: ChatMessage) => {
    const asset = msg.extra?.asset;
    void addEmojiMutation.mutateAsync({
      body: {
        url: msg.content,
        fileId: asset?.fileId ?? null,
        name: asset?.name ?? null,
        width: asset?.width ?? null,
        height: asset?.height ?? null,
      },
    }).then(() => Toast.success('已收藏为表情')).catch(() => undefined);
  }, [addEmojiMutation]);

  // 正在输入信号：3s 前沿节流（窗口内多次输入只发一次）
  const sendTypingSignal = useThrottledCallback((conversationId: number, userId: number) => {
    sendWsMessage({ type: 'chat:typing', payload: { conversationId, userId, nickname: currentUserNickname } });
  }, { wait: 3000, leading: true, trailing: false });

  const handleTyping = useCallback((newValue: string) => {
    if (!activeConvId || !currentUserId || !newValue.trim()) return;
    sendTypingSignal(activeConvId, currentUserId);
  }, [activeConvId, currentUserId, sendTypingSignal]);

  const sendImageFile = useCallback(async (file: File, onProgress?: (percent: number) => void) => {
    if (!activeConvId) return false;
    const dimensions = await getImageDimensions(file);
    const fd = new FormData();
    fd.append('file', file);
    const uploadRes = await request.postForm<ManagedFile>(urlOf(fileContract.uploadOne), fd, { onProgress, silent: true });
    if (uploadRes.code !== 0 || !uploadRes.data) {
      return false;
    }
    const { url, originalName, size } = uploadRes.data;
    const asset: ChatAssetMeta = {
      kind: 'image',
      name: originalName,
      size,
      mimeType: file.type || null,
      extension: getFileExtension(originalName),
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
      thumbnailUrl: url,
    };
    const msg = await api(chatContract.sendMessage, {
      params: { id: activeConvId },
      body: { content: url, type: 'image', extra: { asset } },
    }, { silent: true }).catch(() => null);
    if (msg) appendMessageOnce(msg);
    return Boolean(msg);
  }, [activeConvId, appendMessageOnce]);

  const sendVoiceMessage = useCallback(async (blob: Blob, durationSec: number, mimeType: string) => {
    if (!activeConvId) return;
    const ext = mimeType.includes('mp4') ? 'm4a' : (mimeType.includes('ogg') ? 'ogg' : 'webm');
    const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: mimeType });
    const fd = new FormData();
    fd.append('file', file);
    let uploaded: ManagedFile;
    try {
      uploaded = await api(fileContract.uploadOne, { body: fd }, { silent: true });
    } catch {
      Toast.error('语音上传失败');
      return;
    }
    const { id: fileId, url, size } = uploaded;
    const asset: ChatAssetMeta = {
      kind: 'voice',
      name: file.name,
      size,
      mimeType,
      extension: ext,
      fileId,
      duration: Math.max(1, Math.round(durationSec)),
    };
    try {
      appendMessageOnce(await api(chatContract.sendMessage, {
        params: { id: activeConvId },
        body: { content: url, type: 'voice', extra: { asset } },
      }, { silent: true }));
    } catch (err) {
      Toast.error(err instanceof Error && err.message ? err.message : '语音发送失败');
    }
  }, [activeConvId, appendMessageOnce]);

  const voiceRecorder = useVoiceRecorder({
    maxSeconds: 60,
    onStop: (blob, seconds, mimeType) => { void sendVoiceMessage(blob, seconds, mimeType); },
    onError: (message) => Toast.warning(message),
  });

  const fetchLinkPreview = useCallback(async (url: string): Promise<ChatLinkPreview | null> => {
    return api(chatContract.linkPreview, { query: { url } }, { silent: true }).catch(() => null);
  }, []);

  return {
    sendFileMessage, sendSticker, handleSaveAsEmoji, handleTyping, sendImageFile, sendVoiceMessage,
    voiceRecorder, fetchLinkPreview,
  };
}
