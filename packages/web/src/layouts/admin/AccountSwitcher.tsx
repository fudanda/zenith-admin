import { useState } from 'react';
import { Button, Divider, Modal, Spin, Tag, Toast, Tooltip, Typography } from '@douyinfe/semi-ui';
import { LogOut, UserPlus, X } from 'lucide-react';
import type { NavigateFunction } from 'react-router-dom';
import { MAX_STORED_ACCOUNTS } from '@arcbase/shared/core';
import { useAuth } from '@/hooks/useAuth';
import { UserAvatar } from '@/components/UserAvatar';
import { prepareTrackerLogout } from '@/utils/tracker';
import './AccountSwitcher.css';

const { Text } = Typography;

/**
 * 账号切换弹层（对齐 GitHub Account switcher）：
 * 列出当前账号与全部停靠账号，支持一键切换、注销单个停靠账号、
 * 添加其他账号与退出全部账号。切换成功后由 AuthProvider 整页重载。
 */
export function AccountSwitcherModal({ visible, onClose, navigate, disconnectWs }: Readonly<{
  visible: boolean;
  onClose: () => void;
  navigate: NavigateFunction;
  disconnectWs?: () => void;
}>) {
  const { user, parkedAccounts, canAddAccount, switchAccount, removeAccount, logoutAllAccounts } = useAuth();
  const [switchingId, setSwitchingId] = useState<number | null>(null);
  const [removingId, setRemovingId] = useState<number | null>(null);

  const handleSwitch = async (userId: number) => {
    if (switchingId !== null) return;
    setSwitchingId(userId);
    try {
      disconnectWs?.();
      const result = await switchAccount(userId);
      if (result.ok) return; // 成功后整页重载，无需收尾
      if (result.expired) {
        Toast.warning(result.message || '该账号登录状态已失效，请重新登录');
        onClose();
        navigate(`/login?add_account=1${result.username ? `&username=${encodeURIComponent(result.username)}` : ''}`);
        return;
      }
      Toast.error(result.message || '切换失败，请稍后重试');
    } finally {
      setSwitchingId(null);
    }
  };

  const handleRemove = (userId: number, name: string) => {
    Modal.confirm({
      title: '退出账号',
      content: `确定要退出账号「${name}」吗？退出后需重新输入密码才能使用。`,
      okText: '退出',
      cancelText: '取消',
      onOk: async () => {
        setRemovingId(userId);
        try {
          await removeAccount(userId);
          Toast.success('已退出该账号');
        } finally {
          setRemovingId(null);
        }
      },
    });
  };

  const handleAddAccount = () => {
    onClose();
    navigate('/login?add_account=1');
  };

  const handleLogoutAll = () => {
    Modal.confirm({
      title: '退出全部账号',
      content: `将退出当前账号与另外 ${parkedAccounts.length} 个已登录账号，确定继续吗？`,
      okText: '全部退出',
      cancelText: '取消',
      onOk: async () => {
        prepareTrackerLogout();
        disconnectWs?.();
        onClose();
        await logoutAllAccounts();
      },
    });
  };

  return (
    <Modal
      title="切换账号"
      visible={visible}
      onCancel={onClose}
      footer={null}
      closeOnEsc
      width={380}
    >
      <div className="account-switcher-list">
        {user && (
          <div className="account-switcher-item is-current">
            <button type="button" className="account-switcher-hit" tabIndex={-1}>
              <UserAvatar name={user.nickname || user.username} avatar={user.avatar} semiSize="default" size={32} />
              <span className="account-switcher-meta">
                <span className="account-switcher-name">{user.nickname || user.username}</span>
                <span className="account-switcher-sub">
                  {user.username}
                  {user.tenantName ? ` · ${user.tenantName}` : ''}
                </span>
              </span>
              <Tag color="green" size="small">当前</Tag>
            </button>
          </div>
        )}
        {parkedAccounts.map((account) => (
          <div className="account-switcher-item" key={account.userId}>
            <button
              type="button"
              className="account-switcher-hit"
              disabled={switchingId !== null}
              onClick={() => void handleSwitch(account.userId)}
            >
              <UserAvatar name={account.nickname || account.username} avatar={account.avatar} semiSize="default" size={32} />
              <span className="account-switcher-meta">
                <span className="account-switcher-name">{account.nickname || account.username}</span>
                <span className="account-switcher-sub">
                  {account.username}
                  {account.tenantName ? ` · ${account.tenantName}` : ''}
                </span>
              </span>
              {switchingId === account.userId && <Spin size="small" />}
            </button>
            <Tooltip content="退出该账号">
              <Button
                className="account-switcher-remove"
                icon={<X size={14} />}
                theme="borderless"
                type="tertiary"
                size="small"
                aria-label={`退出账号 ${account.nickname || account.username}`}
                loading={removingId === account.userId}
                disabled={switchingId !== null}
                onClick={() => handleRemove(account.userId, account.nickname || account.username)}
              />
            </Tooltip>
          </div>
        ))}
      </div>
      <Divider margin={12} />
      <div className="account-switcher-footer">
        <Button icon={<UserPlus size={14} />} block disabled={!canAddAccount} onClick={handleAddAccount}>
          添加其他账号
        </Button>
        {!canAddAccount && (
          <Text type="tertiary" size="small">最多同时保持 {MAX_STORED_ACCOUNTS} 个账号登录，请先退出其中一个。</Text>
        )}
        {parkedAccounts.length > 0 && (
          <Button icon={<LogOut size={14} />} block type="danger" theme="borderless" onClick={handleLogoutAll}>
            退出全部账号
          </Button>
        )}
      </div>
    </Modal>
  );
}
