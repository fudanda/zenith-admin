/**
 * App 推送渠道适配器。
 *
 * 凭证按应用绑定:寻址阶段就按「设备所属应用是否有启用凭证」过滤——
 * 没有凭证的应用(如桌面端)其设备天然不可达,与"没绑邮箱"同语义留痕。
 * 投递阶段按应用分组,各取所属应用凭证分别调用供应商,每个应用组一行发送记录。
 *
 * address 编码:`appId:registrationId` 逗号连接（resolveAddress 与 send 的私有契约）。
 * external 收件人无推送形态,恒不可达。
 */
import { eq } from 'drizzle-orm';
import type { NotificationRecipient } from '@arcbase/shared/messaging';
import { db } from '../../../db';
import { pushSendLogs } from '../../../db/schema';
import { findEnabledPushConfigsByAppIds } from '../../../services/messaging/push-configs.service';
import { clearInvalidPushRegistrations, findPushableDevices } from '../../../services/ops/client-devices.service';
import { sendPushByProvider } from '../../push-sender';
import type { DeliveryContext, DeliveryResult, NotificationChannelAdapter } from '../types';

export const pushAdapter: NotificationChannelAdapter = {
  channel: 'push',

  async resolveAddress(recipient: NotificationRecipient): Promise<string | null> {
    if (recipient.type === 'external') return null;
    const devices = await findPushableDevices(recipient.type, recipient.id);
    if (devices.length === 0) return null;
    // 只保留所属应用有启用凭证的设备;全部无凭证 → 不可达
    const configs = await findEnabledPushConfigsByAppIds([...new Set(devices.map((d) => d.appId))]);
    const reachable = devices.filter((d) => configs.has(d.appId));
    if (reachable.length === 0) return null;
    return reachable.map((d) => `${d.appId}:${d.pushRegistrationId as string}`).join(',');
  },

  async send(ctx: DeliveryContext): Promise<DeliveryResult> {
    // 解析 address 并按应用分组
    const groups = new Map<number, string[]>();
    for (const pair of ctx.target.address.split(',')) {
      const sep = pair.indexOf(':');
      if (sep <= 0) continue;
      const appId = Number(pair.slice(0, sep));
      const registrationId = pair.slice(sep + 1);
      if (!Number.isInteger(appId) || !registrationId) continue;
      const list = groups.get(appId) ?? [];
      list.push(registrationId);
      groups.set(appId, list);
    }
    if (groups.size === 0) throw new Error('推送地址为空');

    const configs = await findEnabledPushConfigsByAppIds([...groups.keys()]);
    const pushOptions = ctx.options?.push;
    const title = pushOptions?.title ?? ctx.title;

    let firstMsgId: string | undefined;
    const failures: string[] = [];

    for (const [appId, registrationIds] of groups) {
      const config = configs.get(appId);
      if (!config) {
        // resolve 与 send 之间凭证被停用的窄窗口:留痕失败,不影响其他应用组
        failures.push(`应用 #${appId} 无启用的推送凭证`);
        continue;
      }

      const [log] = await db.insert(pushSendLogs).values({
        configId: config.id,
        appId,
        provider: config.provider,
        subjectType: ctx.target.recipient.type === 'external' ? null : ctx.target.recipient.type,
        subjectId: ctx.target.subjectId,
        deviceCount: registrationIds.length,
        title,
        content: ctx.content,
        link: ctx.link,
        eventKey: ctx.eventKey,
        status: 'pending',
        source: 'system',
        tenantId: ctx.tenantId,
      }).returning({ id: pushSendLogs.id });

      const result = await sendPushByProvider({
        config,
        registrationIds,
        title,
        content: ctx.content,
        link: ctx.link,
        extras: pushOptions?.extras,
      });

      await db.update(pushSendLogs).set({
        status: result.success ? 'success' : 'failed',
        providerMsgId: result.msgId,
        errorMsg: result.errorMsg,
        sentAt: new Date(),
      }).where(eq(pushSendLogs.id, log.id));

      if (result.success) {
        if (!firstMsgId) firstMsgId = result.msgId ?? String(log.id);
      } else {
        failures.push(result.errorMsg ?? `应用 #${appId} 推送失败`);
      }
      // 供应商点名的无效 RID:清绑定,下次寻址不再包含
      if (result.invalidRegistrationIds?.length) {
        await clearInvalidPushRegistrations(config.provider, result.invalidRegistrationIds);
      }
    }

    // 全部应用组失败才按渠道失败上报(触发 outbox 重投);部分成功时不抛——
    // 重投会对已成功组重复推送,重复扰民比单组漏推更糟,失败组已在发送记录留痕
    if (failures.length > 0 && !firstMsgId) throw new Error(failures.join('; '));
    return { providerMsgId: firstMsgId };
  },
};
