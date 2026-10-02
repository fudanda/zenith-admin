import { Typography } from '@douyinfe/semi-ui';
import { UserAvatar } from '@/components/UserAvatar';
import type { ChatGroupMember } from '@arcbase/shared/chat';
import type { Setter } from '../types';

const { Text } = Typography;

/** @提及候选浮层（自 ChatPage 原样搬移） */
export function MentionPopup({
  mentionListRef, mentionCandidates, mentionActiveIndex, setMentionActiveIndex, insertMention,
}: Readonly<{
  mentionListRef: React.RefObject<HTMLDivElement | null>;
  mentionCandidates: ChatGroupMember[];
  mentionActiveIndex: number;
  setMentionActiveIndex: Setter<number>;
  insertMention: (member: ChatGroupMember) => void;
}>) {
  return (
                <div
                  ref={mentionListRef}
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 48,
                    bottom: 'calc(100% + 8px)',
                    zIndex: 30,
                    background: 'var(--semi-color-bg-2)',
                    border: '1px solid var(--semi-color-border)',
                    borderRadius: 'var(--semi-border-radius-medium)',
                    boxShadow: 'var(--semi-shadow-elevated)',
                    padding: 6,
                    maxHeight: 220,
                    overflowY: 'auto',
                  }}
                >
                  {mentionCandidates.map((member, idx) => (
                    <button
                      key={member.id}
                      type="button"
                      onClick={() => insertMention(member)}
                      onMouseEnter={() => setMentionActiveIndex(idx)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, width: '100%', border: 'none',
                        background: idx === mentionActiveIndex ? 'var(--semi-color-fill-1)' : 'transparent',
                        padding: '6px 8px', textAlign: 'left', cursor: 'pointer', borderRadius: 'var(--semi-border-radius-medium)',
                        transition: 'background 0.1s',
                      }}
                    >
                      <UserAvatar name={member.nickname} avatar={member.avatar} size={26} />
                      <div style={{ minWidth: 0 }}>
                        <Text strong style={{ fontSize: 12 }}>{member.nickname}</Text>
                        <Text type="tertiary" style={{ fontSize: 11, display: 'block' }}>@{member.username}</Text>
                      </div>
                    </button>
                  ))}
                </div>
  );
}
