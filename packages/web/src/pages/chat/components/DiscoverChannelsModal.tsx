import { Button, Empty, Input, Typography, List as SemiList } from '@douyinfe/semi-ui';
import { Search } from 'lucide-react';
import { AppModal } from '@/components/AppModal';
import { UserAvatar } from '@/components/UserAvatar';
import type { Channel } from '@arcbase/shared/messaging';
import type { Setter } from '../types';

const { Text } = Typography;

/** 发现频道弹窗：搜索 + 订阅（自 ChatPage 原样搬移） */
export function DiscoverChannelsModal({
  discoverVisible, setDiscoverVisible, discoverKeyword, setDiscoverKeyword, discoverList, handleSubscribeChannel,
}: Readonly<{
  discoverVisible: boolean;
  setDiscoverVisible: Setter<boolean>;
  discoverKeyword: string;
  setDiscoverKeyword: Setter<string>;
  discoverList: Channel[];
  handleSubscribeChannel: (ch: Channel) => Promise<void>;
}>) {
  return (
      <AppModal
        title="发现频道"
        visible={discoverVisible}
        onCancel={() => setDiscoverVisible(false)}
        footer={null}
        width={480}
      >
        <Input
          prefix={<Search size={14} />}
          placeholder="搜索频道"
          showClear
          value={discoverKeyword}
          onChange={setDiscoverKeyword}
          style={{ marginBottom: 12 }}
        />
        {discoverList.length === 0 ? (
          <Empty description="暂无可订阅的频道" style={{ padding: 32 }} />
        ) : (
          <SemiList
            dataSource={discoverList}
            split={false}
            renderItem={(ch: Channel) => (
              <SemiList.Item
                key={ch.id}
                style={{ padding: '10px 4px' }}
                header={<UserAvatar name={ch.name} avatar={ch.avatar} size={36} />}
                main={(
                  <div style={{ minWidth: 0 }}>
                    <Text strong>{ch.name}</Text>
                    <Text type="tertiary" size="small" style={{ display: 'block' }}>{ch.description}</Text>
                  </div>
                )}
                extra={<Button size="small" type="primary" theme="light" onClick={() => void handleSubscribeChannel(ch)}>订阅</Button>}
              />
            )}
          />
        )}
      </AppModal>
  );
}
