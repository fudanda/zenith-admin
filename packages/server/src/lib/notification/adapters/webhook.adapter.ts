/**
 * Webhook 渠道适配器。
 *
 * Webhook 是「一个地址」而不是「一个人」，因此只对 external 收件人可达：
 * 若允许系统用户解析出同一个 URL，一条事件发给 5 个接收人就会把同一个
 * Webhook 打 5 次。调用方需要显式传入
 * `{ type: 'external', channel: 'webhook', address: url }`。
 */
import type { NotificationRecipient } from '@arcbase/shared/messaging';
import { httpPost } from '../../http-client';
import type { DeliveryContext, DeliveryResult, NotificationChannelAdapter } from '../types';

const WEBHOOK_TIMEOUT_MS = 8000;

export const webhookAdapter: NotificationChannelAdapter = {
  channel: 'webhook',

  resolveAddress(recipient: NotificationRecipient): Promise<string | null> {
    if (recipient.type !== 'external' || recipient.channel !== 'webhook') return Promise.resolve(null);
    return Promise.resolve(recipient.address);
  },

  async send(ctx: DeliveryContext): Promise<DeliveryResult> {
    const body = ctx.options?.webhook?.body ?? {
      event: ctx.eventKey,
      title: ctx.title,
      content: ctx.content,
      link: ctx.link,
      variables: ctx.vars,
    };
    await httpPost(ctx.target.address, body, { timeout: WEBHOOK_TIMEOUT_MS, ssrfProtection: true });
    return {};
  },
};
