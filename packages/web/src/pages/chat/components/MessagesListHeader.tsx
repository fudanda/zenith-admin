import { Spin, Typography, List as SemiList } from '@douyinfe/semi-ui';
import { Pin, PinOff } from 'lucide-react';
import type { ChatMessage } from '@arcbase/shared/chat';
import { getMessageSummary } from '../utils';
import { WsDisconnectedBanner } from './WsDisconnectedBanner';

const { Text } = Typography;

/** 消息列表顶部：断线提示、置顶消息条、加载更多提示（自 ChatPage Virtuoso Header 原样搬移） */
export function MessagesListHeader({
  isQuick, wsConnected, pinnedMessages, scrollToMessage, handleTogglePinMessage, hasMore,
  loadingMsgs,
}: Readonly<{
  isQuick: boolean;
  wsConnected: boolean;
  pinnedMessages: ChatMessage[];
  scrollToMessage: (messageId: number) => Promise<void>;
  handleTogglePinMessage: (msg: ChatMessage) => Promise<void>;
  hasMore: boolean;
  loadingMsgs: boolean;
}>) {
  return (
                      <div style={{ padding: isQuick ? '8px 12px 0' : '12px 20px 0' }}>
                        {!wsConnected && <WsDisconnectedBanner marginBottom={10} />}
                        {pinnedMessages.length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10, padding: '8px 10px', borderRadius: 'var(--semi-border-radius-medium)', background: 'var(--semi-color-fill-0)', border: '1px solid var(--semi-color-border)' }}>
                            <Text strong style={{ fontSize: 12 }}><Pin size={12} style={{ marginRight: 4, verticalAlign: 'text-bottom' }} />置顶消息</Text>
                              <SemiList
                                dataSource={pinnedMessages}
                                split={false}
                                renderItem={(item: ChatMessage) => (
                                  <SemiList.Item
                                    key={item.id}
                                    align="center"
                                    onClick={() => scrollToMessage(item.id)}
                                    style={{ padding: 0, cursor: 'pointer' }}
                                    main={(
                                      <Text type="tertiary" style={{ fontSize: 12, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {getMessageSummary(item)}
                                      </Text>
                                    )}
                                    extra={(
                                      <button
                                        type="button"
                                        title="取消置顶"
                                        onClick={(event) => { event.stopPropagation(); void handleTogglePinMessage(item); }}
                                        style={{ flexShrink: 0, border: 'none', background: 'transparent', padding: 2, cursor: 'pointer', color: 'var(--semi-color-text-2)', display: 'flex', alignItems: 'center', borderRadius: 'var(--semi-border-radius-small)' }}
                                        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--semi-color-danger)'; }}
                                        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--semi-color-text-2)'; }}
                                      >
                                        <PinOff size={12} />
                                      </button>
                                    )}
                                  />
                                )}
                              />
                          </div>
                        )}
                        {hasMore && loadingMsgs && (
                          <div style={{ textAlign: 'center', marginBottom: 8, minHeight: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Spin size="small" />
                          </div>
                        )}
                      </div>
  );
}
