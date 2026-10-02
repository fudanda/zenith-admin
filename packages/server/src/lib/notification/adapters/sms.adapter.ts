/**
 * 短信渠道适配器。
 *
 * 短信必须走已备案的模板，没有 `channelOptions.sms.templateId` 就无法投递——
 * 这种情况按「不可达」处理并留痕，而不是抛错让整条事件失败。
 */
import { eq } from 'drizzle-orm';
import type { NotificationRecipient } from '@arcbase/shared/messaging';
import { db } from '../../../db';
import { members, smsSendLogs, smsTemplates, users } from '../../../db/schema';
import { findDefaultSmsConfig } from '../../../services/messaging/sms-configs.service';
import { renderTemplate, sendSmsByProvider } from '../../sms-sender';
import type { DeliveryContext, DeliveryResult, NotificationChannelAdapter } from '../types';

async function lookupPhone(recipient: NotificationRecipient): Promise<string | null> {
  if (recipient.type === 'external') {
    return recipient.channel === 'sms' ? recipient.address : null;
  }
  if (recipient.type === 'user') {
    const [row] = await db.select({ phone: users.phone, status: users.status })
      .from(users).where(eq(users.id, recipient.id)).limit(1);
    if (!row || row.status !== 'enabled') return null;
    return row.phone || null;
  }
  const [row] = await db.select({ phone: members.phone })
    .from(members).where(eq(members.id, recipient.id)).limit(1);
  return row?.phone || null;
}

/**
 * 按模板占位符出现顺序从来源变量中挑选参数。
 *
 * 服务商按位置映射参数（腾讯云 `Object.values`），而事件 vars 经 jsonb 往返后
 * 键序会被 PG 重排；以模板内容为准既保证顺序确定，也不会把模板未声明的
 * 多余变量提交给服务商。导出仅供单测。
 */
export function buildTemplateVariables(
  templateContent: string,
  source: Record<string, string>,
): Record<string, string> {
  const placeholderNames = [...new Set(
    [...templateContent.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((match) => match[1]),
  )];
  const variables: Record<string, string> = {};
  for (const name of placeholderNames) variables[name] = source[name] ?? '';
  return variables;
}

export const smsAdapter: NotificationChannelAdapter = {
  channel: 'sms',

  async resolveAddress(recipient, options): Promise<string | null> {
    // 没有指定模板就没有可发的短信，提前判不可达，避免在投递阶段抛出无意义的失败
    if (!options?.sms?.templateId) return null;
    return lookupPhone(recipient);
  },

  async send(ctx: DeliveryContext): Promise<DeliveryResult> {
    const templateId = ctx.options?.sms?.templateId;
    if (!templateId) throw new Error('短信渠道缺少模板配置');

    const [config, [template]] = await Promise.all([
      findDefaultSmsConfig(),
      db.select().from(smsTemplates).where(eq(smsTemplates.id, templateId)).limit(1),
    ]);
    if (!config) throw new Error('未配置默认短信服务商');
    if (!template) throw new Error(`短信模板 ${templateId} 不存在`);
    if (template.status !== 'enabled') throw new Error(`短信模板「${template.name}」已禁用`);
    if (config.provider !== template.provider) {
      throw new Error(`默认短信配置（${config.provider}）与模板服务商（${template.provider}）不匹配`);
    }

    const source = ctx.options?.sms?.variables ?? ctx.vars;
    const variables = buildTemplateVariables(template.content, source);

    const renderedContent = renderTemplate(template.content, variables);
    const [log] = await db.insert(smsSendLogs).values({
      configId: config.id,
      templateId: template.id,
      provider: config.provider,
      phone: ctx.target.address,
      content: renderedContent,
      status: 'pending',
      source: 'system',
      userId: ctx.target.recipient.type === 'user' ? ctx.target.subjectId : null,
      tenantId: ctx.tenantId,
    }).returning({ id: smsSendLogs.id });

    const result = await sendSmsByProvider({
      config,
      template,
      phone: ctx.target.address,
      variables,
      renderedContent,
    });

    await db.update(smsSendLogs).set({
      status: result.success ? 'success' : 'failed',
      bizId: result.bizId,
      errorMsg: result.errorMsg,
      sentAt: new Date(),
    }).where(eq(smsSendLogs.id, log.id));

    if (!result.success) throw new Error(result.errorMsg || '短信发送失败');
    return { providerMsgId: result.bizId ?? String(log.id) };
  },
};
