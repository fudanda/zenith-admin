/**
 * 邮件渠道适配器。
 *
 * 除了实际发信，还会补写一条 `email_send_logs`：
 * 「系统管理 / 邮件发送记录」是运维排查邮件问题的既有入口，
 * 通知中心发出的邮件如果不落在同一张表里，那个页面就会出现看不见的盲区。
 */
import { eq } from 'drizzle-orm';
import type { NotificationChannelOptions, NotificationRecipient } from '@arcbase/shared/messaging';
import { db } from '../../../db';
import { emailSendLogs, members, users } from '../../../db/schema';
import { sendMail } from '../../email';
import { escapeHtml } from '@arcbase/shared/core';
import { buildUnsubscribeUrl } from '../unsubscribe';
import type { DeliveryContext, DeliveryResult, NotificationChannelAdapter } from '../types';

async function lookupEmail(recipient: NotificationRecipient): Promise<string | null> {
  if (recipient.type === 'external') {
    return recipient.channel === 'email' ? recipient.address : null;
  }
  if (recipient.type === 'user') {
    const [row] = await db.select({ email: users.email, status: users.status })
      .from(users).where(eq(users.id, recipient.id)).limit(1);
    // 停用账号不再接收邮件：离职后仍持续收到系统邮件是很典型的越权投递
    if (!row || row.status !== 'enabled') return null;
    return row.email || null;
  }
  const [row] = await db.select({ email: members.email })
    .from(members).where(eq(members.id, recipient.id)).limit(1);
  return row?.email || null;
}

function buildHtml(ctx: DeliveryContext, options: NotificationChannelOptions | null): string {
  const custom = options?.email?.html;
  if (custom) return custom;
  const body = `<h3>${escapeHtml(ctx.title)}</h3><p>${escapeHtml(ctx.content)}</p>`;
  if (!ctx.link) return body;
  return `${body}<p><a href="${escapeHtml(ctx.link)}">点击查看详情</a></p>`;
}

export const emailAdapter: NotificationChannelAdapter = {
  channel: 'email',

  resolveAddress(recipient) {
    return lookupEmail(recipient);
  },

  async send(ctx: DeliveryContext): Promise<DeliveryResult> {
    let html = buildHtml(ctx, ctx.options);
    // 允许调用方覆盖主题：站内信标题偏短，邮件主题通常还需要带上业务对象名
    const subject = ctx.options?.email?.subject || ctx.title;

    // 退订链接与 RFC 8058 One-Click 头。三类情况不给退订入口：
    // - mandatory：必达事件本就不可退订；
    // - hidden：摘要等元事件不在偏好矩阵，写入的退订偏好用户永远看不见也改不回；
    // - channelLocked：管理员锁定时退订偏好不生效，「退订成功却继续收到」是合规事故。
    let headers: Record<string, string> | undefined;
    const recipient = ctx.target.recipient;
    const unsubscribable = (recipient.type === 'user' || recipient.type === 'member')
      && !ctx.event.mandatory && !ctx.event.hidden && !ctx.channelLocked;
    if (unsubscribable && (recipient.type === 'user' || recipient.type === 'member')) {
      const url = buildUnsubscribeUrl({
        recipientType: recipient.type,
        recipientId: recipient.id,
        scope: 'event',
        eventKey: ctx.eventKey,
      });
      headers = {
        'List-Unsubscribe': `<${url}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      };
      html += `<hr style="border:none;border-top:1px solid #eee;margin:16px 0"/>`
        + `<p style="color:#999;font-size:12px">不想再收到此类邮件？<a href="${escapeHtml(url)}">退订「${escapeHtml(ctx.event.label)}」的邮件通知</a></p>`;
    }

    const [log] = await db.insert(emailSendLogs).values({
      toEmail: ctx.target.address,
      subject,
      content: html,
      status: 'pending',
      source: 'system',
      userId: ctx.target.recipient.type === 'user' ? ctx.target.subjectId : null,
      tenantId: ctx.tenantId,
    }).returning({ id: emailSendLogs.id });

    try {
      await sendMail(ctx.target.address, subject, html, headers ? { headers } : undefined);
    } catch (err) {
      await db.update(emailSendLogs).set({
        status: 'failed',
        errorMsg: (err instanceof Error ? err.message : String(err)).slice(0, 500),
        sentAt: new Date(),
      }).where(eq(emailSendLogs.id, log.id));
      throw err;
    }

    await db.update(emailSendLogs).set({ status: 'success', sentAt: new Date() })
      .where(eq(emailSendLogs.id, log.id));
    return { providerMsgId: String(log.id) };
  },
};
