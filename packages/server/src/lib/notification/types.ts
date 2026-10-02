/**
 * 通知渠道适配器契约。
 *
 * 派发器只认这份接口，不认具体渠道——新增 Push / 飞书 / 钉钉时只需新增一个
 * 适配器文件并注册，`notify()`、偏好解析与留痕逻辑一行都不用改。
 */
import type {
  NotificationChannel,
  NotificationChannelOptions,
  NotificationEventDef,
  NotificationEventKey,
  NotificationRecipient,
} from '@arcbase/shared/messaging';

/** 已解析出可达地址的收件人。 */
export interface ResolvedRecipient {
  recipient: NotificationRecipient;
  /** 收件人在该渠道上的投递地址（站内信为用户 ID 字符串，邮件为邮箱……） */
  address: string;
  /** 系统用户 / 会员的主键；external 收件人为 null */
  subjectId: number | null;
}

/** 一次渠道投递所需的全部上下文。 */
export interface DeliveryContext {
  eventKey: NotificationEventKey;
  event: NotificationEventDef;
  target: ResolvedRecipient;
  /** 已渲染的标题 */
  title: string;
  /** 已渲染的正文（纯文本） */
  content: string;
  vars: Record<string, string>;
  link: string | null;
  tenantId: number | null;
  /** 单条投递的幂等键，渠道自身支持幂等时应透传 */
  dedupeKey: string | null;
  /** 收件人不可自行关闭该渠道（必达事件或管理员锁定）；退订入口应据此隐藏 */
  channelLocked: boolean;
  options: NotificationChannelOptions | null;
}

export interface DeliveryResult {
  /** 渠道返回的消息标识，便于与服务商侧对账 */
  providerMsgId?: string;
}

export interface NotificationChannelAdapter {
  channel: NotificationChannel;
  /**
   * 解析收件人在本渠道上的地址。
   * 返回 null 表示不可达（没邮箱、没手机号），派发器会记 `unreachable` 而不是当成失败——
   * 「这个人根本没绑邮箱」和「邮件服务器挂了」是两回事，混在一起就没法排查。
   */
  resolveAddress(recipient: NotificationRecipient, options: NotificationChannelOptions | null): Promise<string | null>;
  send(ctx: DeliveryContext): Promise<DeliveryResult>;
}
