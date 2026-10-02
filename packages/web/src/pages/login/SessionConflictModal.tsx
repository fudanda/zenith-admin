import { Button, Typography } from '@douyinfe/semi-ui';
import { ShieldAlert } from 'lucide-react';
import { SESSION_CLIENT_KIND_LABELS, type SessionConflict } from '@arcbase/shared/identity';
import AppModal from '@/components/AppModal';
import DateTimeText from '@/components/DateTimeText';
import { SessionClientIcon } from '@/components/SessionClientTag';
import './SessionConflictModal.css';

const { Text } = Typography;

interface SessionConflictModalProps {
  readonly conflict: SessionConflict | null;
  readonly loading?: boolean;
  /** 用户确认下线其它设备并继续登录 */
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/**
 * 会话并发「拒绝新登录」命中时的确认弹层：展示占用名额的既有设备，用户可选择下线它们并继续登录（凭票据，不必重输密码）。
 * 密码 / MFA / 企业 SSO / 第三方 OAuth 四条路径都在登录页收口到这一个弹层。
 */
export default function SessionConflictModal({ conflict, loading, onConfirm, onCancel }: SessionConflictModalProps) {
  const sessions = conflict?.sessions ?? [];
  return (
    <AppModal
      title="该账号已在其他设备登录"
      visible={conflict !== null}
      onCancel={onCancel}
      maskClosable={false}
      width={440}
      footer={(
        <div className="session-conflict-footer">
          <Button theme="borderless" type="tertiary" onClick={onCancel} disabled={loading}>取消</Button>
          <Button type="danger" theme="solid" loading={loading} onClick={onConfirm}>下线其他设备并登录</Button>
        </div>
      )}
    >
      <div className="session-conflict-intro">
        <ShieldAlert size={18} aria-hidden />
        <Text type="secondary">
          受安全策略限制，该账号最多同时在 {conflict?.maxSessions ?? 1} 处登录。下线以下设备后即可继续；如不是您本人的登录，请尽快修改密码。
        </Text>
      </div>
      <ul className="session-conflict-list" aria-label="占用名额的设备">
        {sessions.map((s, index) => (
          <li key={`${s.ip}-${s.loginAt}-${index}`} className="session-conflict-item">
            <SessionClientIcon client={s.client} size={20} className="session-conflict-icon" />
            <div className="session-conflict-body">
              <div className="session-conflict-title">
                <Text strong>{SESSION_CLIENT_KIND_LABELS[s.client] ?? s.client} · {s.browser} / {s.os}</Text>
              </div>
              <Text type="tertiary" size="small" className="session-conflict-meta">
                {s.location ? `${s.location}（${s.ip}）` : `IP: ${s.ip}`}
                {' · '}登录 <DateTimeText value={s.loginAt} />
                {' · '}活跃 <DateTimeText value={s.lastActiveAt} />
              </Text>
            </div>
          </li>
        ))}
      </ul>
    </AppModal>
  );
}
