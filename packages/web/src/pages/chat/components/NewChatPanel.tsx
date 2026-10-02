import { useState } from 'react';
import { Button, Input, Tabs, TabPane, Toast, Typography } from '@douyinfe/semi-ui';
import { UserSearchList } from './UserSearchList';
import { OrgTreePicker } from './OrgTreePicker';
import type { ChatConversation } from '@arcbase/shared/chat';
import type { ChatUser } from '../types';
import { useCreateChatGroup } from '@/hooks/queries/chat';

const { Text } = Typography;

export function NewChatPanel({
  onSelectUser, onGroupCreated,
}: Readonly<{
  onSelectUser: (user: ChatUser) => void;
  onGroupCreated: (conv: ChatConversation) => void;
}>) {
  const [groupName, setGroupName] = useState('');
  const [groupMembers, setGroupMembers] = useState<ChatUser[]>([]);
  const createGroupMutation = useCreateChatGroup();

  const handleCreateGroup = async () => {
    if (!groupName.trim()) { Toast.warning('请输入群聊名称'); return; }
    let conv: ChatConversation;
    try {
      conv = await createGroupMutation.mutateAsync({
        body: { name: groupName.trim(), memberIds: groupMembers.map((u) => u.id) },
      });
    } catch {
      return;
    }
    setGroupName('');
    setGroupMembers([]);
    onGroupCreated(conv);
  };

  return (
    <Tabs collapsible="auto" size="small" defaultActiveKey="direct">
      <TabPane tab="私聊" itemKey="direct">
        <div style={{ paddingTop: 8 }}>
          <UserSearchList onSelect={onSelectUser} />
        </div>
      </TabPane>
      <TabPane tab="组织架构" itemKey="org">
        <div style={{ paddingTop: 8 }}>
          <OrgTreePicker onSelectUser={onSelectUser} />
        </div>
      </TabPane>
      <TabPane tab="创建群聊" itemKey="group">
        <div style={{ paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Input
            placeholder="群聊名称（最多 64 字符）"
            value={groupName}
            onChange={setGroupName}
            maxLength={64}
          />
          <div>
            <Text type="tertiary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
              选择初始成员（可选，勾选部门可全选）
            </Text>
            <OrgTreePicker
              multiple
              height={260}
              value={groupMembers.map((u) => u.id)}
              onChange={setGroupMembers}
            />
          </div>
          <Button type="primary" loading={createGroupMutation.isPending} onClick={() => { void handleCreateGroup(); }} block>
            创建群聊{groupMembers.length > 0 ? `（已选 ${groupMembers.length} 人）` : ''}
          </Button>
        </div>
      </TabPane>
    </Tabs>
  );
}
