/**
 * 聊天卡片渠道适配器（经系统号定向消息推送）。
 */
import { eq } from 'drizzle-orm';
import type { ChatCard } from '@arcbase/shared/chat';
import type { NotificationRecipient } from '@arcbase/shared/messaging';
import { db } from '../../../db';
import { users } from '../../../db/schema';
import { notifyUserWithCard } from '../../../services/chat/chat-notify.service';
import type { DeliveryContext, DeliveryResult, NotificationChannelAdapter } from '../types';

const GROUP_SOURCE_LABELS: Record<string, string> = {
  workflow: '工作流',
  ops: '系统告警',
  wiki: '知识中心',
  report: '报表中心',
  identity: '组织管理',
  'open-platform': '开放平台',
};

export const chatAdapter: NotificationChannelAdapter = {
  channel: 'chat',

  async resolveAddress(recipient: NotificationRecipient): Promise<string | null> {
    if (recipient.type !== 'user') return null;
    const [row] = await db.select({ id: users.id, status: users.status })
      .from(users).where(eq(users.id, recipient.id)).limit(1);
    if (!row || row.status !== 'enabled') return null;
    return String(row.id);
  },

  async send(ctx: DeliveryContext): Promise<DeliveryResult> {
    const userId = ctx.target.subjectId;
    if (userId === null) throw new Error('聊天卡片收件人缺少用户 ID');

    const card: ChatCard = {
      title: ctx.title,
      text: ctx.content,
      source: GROUP_SOURCE_LABELS[ctx.event.group] ?? '系统通知',
      actions: ctx.link ? [{ key: 'open', label: '查看详情', action: 'link', url: ctx.link }] : null,
    };
    await notifyUserWithCard(userId, card);
    return {};
  },
};
