import { useEffect } from 'react';
import { chatContract } from '@arcbase/shared/chat';
import type { ChatConversation, ChatGroupMember } from '@arcbase/shared/chat';
import { api } from '@/lib/contract-query';
import type { GroupAvatarMap, Setter } from '../types';

/** 群聊九宫格头像成员缓存补齐（自 ChatPage 原样搬移） */
export function useGroupAvatars({
  conversations, groupAvatarMap, setGroupAvatarMap, refreshGroupAvatarMembers,
}: {
  conversations: ChatConversation[];
  groupAvatarMap: GroupAvatarMap;
  setGroupAvatarMap: Setter<GroupAvatarMap>;
  refreshGroupAvatarMembers: (conversationId: number) => Promise<void>;
}) {
  useEffect(() => {
    const groupIds = conversations.filter((c) => c.type === 'group').map((c) => c.id);
    const missingIds = groupIds.filter((id) => !groupAvatarMap[id]);
    if (missingIds.length === 0) return;

    let cancelled = false;
    void Promise.all(
      missingIds.map(async (id) => {
        const members = await api(chatContract.groupMembers, { params: { id } }, { silent: true }).catch(() => null);
        return [id, (members ?? []).slice(0, 9)] as const;
      }),
    ).then((entries) => {
      if (cancelled) return;
      const toAvatarMember = (m: ChatGroupMember) => ({ id: m.id, nickname: m.nickname, avatar: m.avatar });
      setGroupAvatarMap((prev) => {
        const next = { ...prev };
        for (const [id, members] of entries) {
          next[id] = members.map(toAvatarMember);
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [conversations, groupAvatarMap, refreshGroupAvatarMembers, setGroupAvatarMap]);
}
