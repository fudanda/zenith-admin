import { Typography, List as SemiList } from '@douyinfe/semi-ui';
import { formatConvTime } from '@/utils/date';
import type { ChatConversation, ChatMessage } from '@arcbase/shared/chat';
import { getMessageSummary } from '../utils';
import type { LeftPaneContextMenuState, Setter } from '../types';

const { Text } = Typography;

/** 左栏收藏消息列表行（自 ChatPage renderItem 原样搬移） */
export function FavoriteListRow({
  msg, conversations, setFavPreviewMsg, setFavPreviewVisible, setLeftPaneContextMenu,
}: Readonly<{
  msg: ChatMessage;
  conversations: ChatConversation[];
  setFavPreviewMsg: Setter<ChatMessage | null>;
  setFavPreviewVisible: Setter<boolean>;
  setLeftPaneContextMenu: Setter<LeftPaneContextMenuState | null>;
}>) {
                  const conv = conversations.find((item) => item.id === msg.conversationId);
                  const convName = conv?.type === 'direct' ? (conv.targetUser?.nickname ?? '私聊') : (conv?.name ?? '群聊');
                  return (
                    <SemiList.Item
                      key={msg.id}
                      onClick={() => {
                        setFavPreviewMsg(msg);
                        setFavPreviewVisible(true);
                      }}
                      onRightClick={(e) => {
                        e.preventDefault();
                        setLeftPaneContextMenu({ x: e.clientX, y: e.clientY, type: 'favorite', msg });
                      }}
                      style={{ padding: '10px 12px', cursor: 'pointer' }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--semi-color-fill-0)'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                      main={(
                        <div style={{ minWidth: 0, width: '100%' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                            <Text strong style={{ fontSize: 12, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{convName}</Text>
                            <Text type="tertiary" style={{ fontSize: 11, flexShrink: 0 }}>{formatConvTime(msg.createdAt)}</Text>
                          </div>
                          <Text type="tertiary" style={{ display: 'block', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {getMessageSummary(msg)}
                          </Text>
                        </div>
                      )}
                    />
                  );
}
