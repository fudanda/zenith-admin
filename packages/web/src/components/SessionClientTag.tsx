import type { ComponentType } from 'react';
import { Tag } from '@douyinfe/semi-ui';
import type { TagColor } from '@douyinfe/semi-ui/lib/es/tag';
import { Laptop, Monitor, Smartphone, type LucideProps } from 'lucide-react';
import { SESSION_CLIENT_KIND_LABELS, type SessionClientKind } from '@arcbase/shared/identity';

const ICONS: Record<SessionClientKind, ComponentType<LucideProps>> = {
  web: Monitor,
  mobile: Smartphone,
  desktop: Laptop,
};

const COLORS: Record<SessionClientKind, TagColor> = {
  web: 'blue',
  mobile: 'green',
  desktop: 'violet',
};

/** 登录终端图标（网页 / 移动审批 / 桌面端），我的设备列表与会话弹层共用 */
export function SessionClientIcon({ client, size = 16, className }: Readonly<{ client: SessionClientKind; size?: number; className?: string }>) {
  const Icon = ICONS[client] ?? Monitor;
  return <Icon size={size} className={className} aria-label={SESSION_CLIENT_KIND_LABELS[client] ?? client} />;
}

/** 登录终端标签：在线用户列表的「终端」列 */
export function SessionClientTag({ client, size = 'small' }: Readonly<{ client: SessionClientKind; size?: 'small' | 'large' }>) {
  const Icon = ICONS[client] ?? Monitor;
  return (
    <Tag color={COLORS[client] ?? 'grey'} size={size} prefixIcon={<Icon size={12} aria-hidden />}>
      {SESSION_CLIENT_KIND_LABELS[client] ?? client}
    </Tag>
  );
}
