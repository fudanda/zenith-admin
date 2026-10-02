import { useEffect, useState } from 'react';
import { Button, Spin, Toast, Typography } from '@douyinfe/semi-ui';
import { QRCodeSVG } from 'qrcode.react';
import { Copy } from 'lucide-react';
import { AppModal } from '@/components/AppModal';
import { copyTextWithToast } from '@/utils/clipboard';
import { useChatGroupInvite, useResetChatGroupInvite } from '@/hooks/queries/chat';
import type { ChatGroupInvite } from '@arcbase/shared/chat';
import { ResetButton } from '@/components/toolbar-controls';

const { Text } = Typography;

function inviteUrl(token: string): string {
  return `${globalThis.location.origin}/chat?invite=${token}`;
}

/** 群邀请弹窗：链接 + 二维码 + 复制 + 重置 */
export function GroupInviteModal({
  conversationId, groupName, visible, onClose,
}: Readonly<{
  conversationId: number;
  groupName: string;
  visible: boolean;
  onClose: () => void;
}>) {
  const [invite, setInvite] = useState<ChatGroupInvite | null>(null);
  const getInviteMutation = useChatGroupInvite();
  const resetInviteMutation = useResetChatGroupInvite();

  useEffect(() => {
    if (!visible) return;
    getInviteMutation.mutateAsync({ params: { id: conversationId } }).then(setInvite).catch(() => setInvite(null));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, conversationId]);

  const url = invite ? inviteUrl(invite.token) : '';

  const handleCopy = () => copyTextWithToast(
    `邀请你加入群聊「${groupName}」，打开链接即可加入：${url}`,
    { success: '邀请链接已复制', error: '复制失败，请手动复制' },
  );

  const handleReset = async () => {
    try {
      const next = await resetInviteMutation.mutateAsync({ params: { id: conversationId } });
      setInvite(next);
      Toast.success('已重置，旧链接立即失效');
    } catch {
      /* Toast handled by request layer */
    }
  };

  return (
    <AppModal title={`邀请加入「${groupName}」`} visible={visible} onCancel={onClose} footer={null} width={400}>
      {getInviteMutation.isPending && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}><Spin /></div>
      )}
      {!getInviteMutation.isPending && invite && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <div style={{ padding: 12, background: '#fff', borderRadius: 'var(--semi-border-radius-medium)', border: '1px solid var(--semi-color-border)' }}>
            <QRCodeSVG value={url} size={168} />
          </div>
          <Text
            copyable={{ content: url }}
            type="tertiary"
            style={{ fontSize: 12, wordBreak: 'break-all', textAlign: 'center' }}
          >
            {url}
          </Text>
          <Text type="tertiary" style={{ fontSize: 11 }}>
            {invite.expiresAt ? `有效期至 ${invite.expiresAt}` : '永久有效'} · 已使用 {invite.usedCount} 次
          </Text>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button type="primary" icon={<Copy size={14} />} onClick={() => { void handleCopy(); }}>复制邀请</Button>
            <ResetButton onClick={() => { void handleReset(); }} loading={resetInviteMutation.isPending}>重置链接</ResetButton>
          </div>
        </div>
      )}
    </AppModal>
  );
}
