import { Popover, Typography } from '@douyinfe/semi-ui';
import { UserAvatar } from '@/components/UserAvatar';
import type { ChatConversation } from '@arcbase/shared/chat';
import { formatPresenceText } from '../utils-state';
import type { GroupAvatarMap } from '../types';
import { GroupGridAvatar } from './GroupGridAvatar';

const { Text, Title } = Typography;

/** 会话头部标题区：单聊在线状态 / 群聊成员气泡（自 ChatPage 原样搬移） */
export function ChatConvTitle({
  activeConv, isQuick, onlineUserIds, lastSeenMap, groupAvatarMap,
}: Readonly<{
  activeConv: ChatConversation;
  isQuick: boolean;
  onlineUserIds: Set<number>;
  lastSeenMap: Record<number, string | null>;
  groupAvatarMap: GroupAvatarMap;
}>) {
  return (
    <>
            {activeConv.type === 'direct' && activeConv.targetUser && (
              <Popover
                trigger="click"
                position="bottomLeft"
                showArrow
                content={(
                  <div style={{ padding: '8px 4px', minWidth: 220 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                      <UserAvatar name={activeConv.targetUser.nickname} avatar={activeConv.targetUser.avatar} size={44} />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 15 }}>{activeConv.targetUser.nickname}</div>
                        {activeConv.targetUser.departmentName && (
                          <div style={{ color: 'var(--semi-color-text-2)', fontSize: 12, marginTop: 2 }}>{activeConv.targetUser.departmentName}</div>
                        )}
                      </div>
                    </div>
                    {(activeConv.targetUser.positionNames ?? []).length > 0 && (
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                        <span style={{ color: 'var(--semi-color-text-2)', fontSize: 13, minWidth: 52 }}>岗位</span>
                        <span style={{ fontSize: 13 }}>{(activeConv.targetUser.positionNames ?? []).join('、')}</span>
                      </div>
                    )}
                    {activeConv.targetUser.phone && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <span style={{ color: 'var(--semi-color-text-2)', fontSize: 13, minWidth: 52 }}>手机</span>
                        <span style={{ fontSize: 13 }}>{activeConv.targetUser.phone}</span>
                      </div>
                    )}
                    {activeConv.targetUser.email && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ color: 'var(--semi-color-text-2)', fontSize: 13, minWidth: 52 }}>邮箱</span>
                        <span style={{ fontSize: 13 }}>{activeConv.targetUser.email}</span>
                      </div>
                    )}
                  </div>
                )}
              >
                <span style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: isQuick ? 6 : 8, maxWidth: '60%', minWidth: 0 }}>
                  {/* 状态点省略：右侧已有「在线/最近在线」文字，头像再叠点属重复表达 */}
                  <UserAvatar name={activeConv.targetUser.nickname} avatar={activeConv.targetUser.avatar} size={24} />
                  <span style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0, overflow: 'hidden' }}>
                    <Title
                      heading={6}
                      style={{
                        margin: 0,
                        lineHeight: '1.2',
                        fontSize: isQuick ? 15 : undefined,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        flexShrink: 0,
                      }}
                    >
                      {activeConv.targetUser.nickname}
                    </Title>
                    <Text size="small" type="tertiary" style={{ whiteSpace: 'nowrap', flexShrink: 0, color: onlineUserIds.has(activeConv.targetUser.id) ? 'var(--semi-color-success)' : undefined }}>
                      {formatPresenceText(onlineUserIds.has(activeConv.targetUser.id), lastSeenMap[activeConv.targetUser.id])}
                    </Text>
                  </span>
                </span>
              </Popover>
            )}
            {activeConv.type === 'group' && (
              <>
                <GroupGridAvatar name={activeConv.name ?? '群聊'} size={24} members={groupAvatarMap[activeConv.id]} />
                <Title
                  heading={6}
                  style={{
                    margin: 0,
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontSize: isQuick ? 15 : undefined,
                  }}
                >
                  {activeConv.name ?? '群聊'}
                </Title>
              </>
            )}
    </>
  );
}
