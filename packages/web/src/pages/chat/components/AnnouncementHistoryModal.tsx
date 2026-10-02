import { Button, Empty, Typography, List as SemiList } from '@douyinfe/semi-ui';
import { AppModal } from '@/components/AppModal';
import DateTimeText from '@/components/DateTimeText';
import type { ChatMessage } from '@arcbase/shared/chat';
import type { Setter } from '../types';

const { Text } = Typography;

/** 群公告历史弹窗（自 ChatPage 原样搬移） */
export function AnnouncementHistoryModal({
  announcementHistoryVisible, setAnnouncementHistoryVisible, announcementHistory, isOwnerOfActiveGroup, handleDeleteAnnouncementHistory,
}: Readonly<{
  announcementHistoryVisible: boolean;
  setAnnouncementHistoryVisible: Setter<boolean>;
  announcementHistory: ChatMessage[];
  isOwnerOfActiveGroup: boolean;
  handleDeleteAnnouncementHistory: (messageId: number) => void;
}>) {
  return (
          <AppModal
            title="群公告历史"
            visible={announcementHistoryVisible}
            onCancel={() => setAnnouncementHistoryVisible(false)}
            footer={null}
            width={560}
          >
            <SemiList
              dataSource={announcementHistory}
              emptyContent={<Empty description="暂无公告历史" imageStyle={{ width: 72 }} style={{ padding: '20px 0' }} />}
              style={{ maxHeight: 420, overflowY: 'auto' }}
              renderItem={(item) => (
                <SemiList.Item
                  key={item.id}
                  main={(
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                        <Text strong style={{ fontSize: 12 }}>{item.extra?.announcementHistory?.operatorName ?? item.senderName ?? '系统'}</Text>
                        <Text type="tertiary" style={{ fontSize: 11 }}><DateTimeText value={item.createdAt} /></Text>
                      </div>
                      <Text style={{ fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {item.extra?.announcementHistory?.announcement || '已清空群公告'}
                      </Text>
                    </>
                  )}
                  extra={isOwnerOfActiveGroup ? (
                    <Button
                      theme="borderless"
                      type="danger"
                      size="small"
                      onClick={() => handleDeleteAnnouncementHistory(item.id)}
                    >
                      删除
                    </Button>
                  ) : null}
                />
              )}
            />
          </AppModal>
  );
}
