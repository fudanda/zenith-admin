import { useCallback } from 'react';
import { Toast } from '@douyinfe/semi-ui';
import type { NavigateFunction } from 'react-router-dom';
import { callManager } from '@/webrtc/useCallManager';
import type { ChatCardAction, ChatConversation, ChatMessage } from '@arcbase/shared/chat';
import type { Setter } from '../types';
import { isRootRelativePath } from '@arcbase/shared/core';
import { openExternalUrl } from '@/utils/safe-url';

/** 卡片消息动作（工作流审批/链接跳转）与音视频通话发起（自 ChatPage 原样搬移） */
export function useCardAndCall({
  activeConv, navigate, setCardSheet,
}: {
  activeConv: ChatConversation | null;
  navigate: NavigateFunction;
  setCardSheet: Setter<{ instanceId: number; taskId: number | null; action: 'approve' | 'reject' | null; messageId?: number } | null>;
}) {
  const handleOpenWorkflowFromCard = useCallback((instanceId: number, taskId: number | null) => {
    setCardSheet({ instanceId, taskId, action: null });
  }, [setCardSheet]);

  const handleCardAction = useCallback((msg: ChatMessage, action: ChatCardAction) => {
    const instanceId = msg.extra?.card?.instanceId ?? null;
    if (action.action === 'workflow:approve' && instanceId != null) {
      setCardSheet({ instanceId, taskId: action.taskId ?? null, action: 'approve', messageId: msg.id });
    } else if (action.action === 'workflow:reject' && instanceId != null) {
      setCardSheet({ instanceId, taskId: action.taskId ?? null, action: 'reject', messageId: msg.id });
    } else if (action.action === 'link' && action.url) {
      if (isRootRelativePath(action.url)) navigate(action.url);
      else openExternalUrl(action.url);
    }
  }, [navigate, setCardSheet]);

  // ── 音视频通话 ──
  const handleStartCall = useCallback((callType: 'audio' | 'video') => {
    if (!activeConv) return;
    if (activeConv.type === 'direct') {
      const t = activeConv.targetUser;
      if (!t) return;
      void callManager.startDirectCall(
        { userId: t.id, nickname: t.nickname, avatar: t.avatar ?? null },
        activeConv.id,
        t.nickname,
        callType,
      ).catch((e) => Toast.error(e instanceof Error ? e.message : '无法发起通话'));
    } else {
      void callManager.startGroupCall(activeConv.id, activeConv.name ?? '群通话', callType)
        .catch((e) => Toast.error(e instanceof Error ? e.message : '无法发起通话'));
    }
  }, [activeConv]);

  return { handleOpenWorkflowFromCard, handleCardAction, handleStartCall };
}
