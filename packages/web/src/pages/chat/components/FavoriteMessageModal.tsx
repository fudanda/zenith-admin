import { Button, Typography } from '@douyinfe/semi-ui';
import { Bookmark, Search } from 'lucide-react';
import { AppModal } from '@/components/AppModal';
import { UserAvatar } from '@/components/UserAvatar';
import DateTimeText from '@/components/DateTimeText';
import type { ChatConversation, ChatMessage, ChatMessageExtra } from '@arcbase/shared/chat';
import type { Setter } from '../types';
import { MessageContent } from './MessageContent';

const { Text } = Typography;

/** 收藏消息预览弹窗（自 ChatPage 原样搬移；原为 IIFE，改为组件内计算） */
export function FavoriteMessageModal({
  favPreviewMsg, conversations, favPreviewVisible, setFavPreviewVisible, handleToggleFavorite, openFavoriteMessage,
  handleOpenForwardView,
}: Readonly<{
  favPreviewMsg: ChatMessage;
  conversations: ChatConversation[];
  favPreviewVisible: boolean;
  setFavPreviewVisible: Setter<boolean>;
  handleToggleFavorite: (msg: ChatMessage) => Promise<void>;
  openFavoriteMessage: (message: ChatMessage) => Promise<void>;
  handleOpenForwardView: (items: NonNullable<ChatMessageExtra['forwardedMessages']>, title: string) => void;
}>) {
        const conv = conversations.find((c) => c.id === favPreviewMsg.conversationId);
        const convName = conv?.type === 'direct' ? (conv.targetUser?.nickname ?? '私聊') : (conv?.name ?? '群聊');
        return (
          <AppModal
            title={
              <div>
                <div>收藏的消息</div>
                <Text type="tertiary" style={{ fontSize: 12, fontWeight: 'normal' }}>{convName}</Text>
              </div>
            }
            visible={favPreviewVisible}
            onCancel={() => setFavPreviewVisible(false)}
            footer={
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <Button
                  type="tertiary"
                  theme="borderless"
                  icon={<Bookmark size={14} />}
                  onClick={() => {
                    void handleToggleFavorite(favPreviewMsg);
                    setFavPreviewVisible(false);
                  }}
                >
                  取消收藏
                </Button>
                <Button
                  type="primary"
                  icon={<Search size={14} />}
                  onClick={() => {
                    setFavPreviewVisible(false);
                    void openFavoriteMessage(favPreviewMsg);
                  }}
                >
                  定位消息
                </Button>
              </div>
            }
            width={520}
          >
            <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <UserAvatar name={favPreviewMsg.senderName ?? '未知'} avatar={favPreviewMsg.senderAvatar} size={32} />
              <div>
                <Text strong style={{ fontSize: 13, display: 'block' }}>{favPreviewMsg.senderName ?? '未知'}</Text>
                <Text type="tertiary" style={{ fontSize: 11 }}><DateTimeText value={favPreviewMsg.createdAt} /></Text>
              </div>
            </div>
            <div style={{ background: 'var(--semi-color-fill-0)', borderRadius: 'var(--semi-border-radius-medium)', padding: 12 }}>
              <MessageContent
                msg={favPreviewMsg}
                isSelf={false}
                onOpenForwardView={handleOpenForwardView}
              />
            </div>
          </AppModal>
        );
}
