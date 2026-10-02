/**
 * 沙箱回调协议。每份沙箱商户配置使用独立密钥对原始报文做 HMAC，
 * 同时绑定配置 ID、事件 ID 和时间戳。公开请求头不再具有任何信任语义。
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { formatDateTime, parseDateTimeInput } from '../datetime';
import type { AdapterContext, NotifyResult } from './types';

/** @deprecated 仅保留名称避免并发改造期间编译中断；验证逻辑不再信任该请求头。 */
export const SANDBOX_NOTIFY_HEADER = 'X-Sandbox-Notify';
export const SANDBOX_NOTIFY_TIMESTAMP_HEADER = 'X-ArcBase-Sandbox-Timestamp';
export const SANDBOX_NOTIFY_SIGNATURE_HEADER = 'X-ArcBase-Sandbox-Signature';

const SANDBOX_TIMESTAMP_WINDOW_SECONDS = 5 * 60;

const SANDBOX_TRADE_STATUSES = ['success', 'closed', 'failed', 'refunded'] as const;

export interface SandboxNotifyPayload {
  sandbox: true;
  channelConfigId: number;
  providerEventId: string;
  /** Unix 秒级时间戳，必须与签名头一致。 */
  timestamp: number;
  scene: 'payment' | 'refund';
  outTradeNo?: string;
  outRefundNo?: string;
  channelTradeNo?: string;
  channelRefundNo?: string;
  tradeStatus: (typeof SANDBOX_TRADE_STATUSES)[number];
  /** 实付金额（分） */
  paidAmount?: number;
  currency: string;
  merchantId?: string;
  providerAppId?: string;
  /** YYYY-MM-DD HH:mm:ss */
  paidAt?: string;
}

function signSandboxNotify(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

function signatureMatches(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  return actualBuffer.length === expectedBuffer.length
    && actualBuffer.length > 0
    && timingSafeEqual(actualBuffer, expectedBuffer);
}

/** 构造未签名沙箱报文。调用公开回调时必须改用 buildSandboxNotifyRequest。 */
export function buildSandboxNotifyBody(payload: Omit<SandboxNotifyPayload, 'sandbox'>): string {
  return JSON.stringify({ sandbox: true, ...payload });
}

/** @deprecated 旧报文缺少配置绑定与签名，不能通过新版沙箱验签。 */
export function buildSandboxPaidNotifyBody(input: { outTradeNo: string; paidAmount: number; channelTradeNo?: string }): string {
  return JSON.stringify({
    sandbox: true,
    scene: 'payment',
    outTradeNo: input.outTradeNo,
    channelTradeNo: input.channelTradeNo ?? `SIM${Date.now()}`,
    tradeStatus: 'success',
    paidAmount: input.paidAmount,
    paidAt: formatDateTime(new Date()),
  });
}

export type BuildSandboxNotifyRequestInput = Omit<
  SandboxNotifyPayload,
  'sandbox' | 'timestamp' | 'providerEventId' | 'currency'
> & {
  secret: string;
  timestamp?: number;
  providerEventId?: string;
  currency?: string;
};

/** 构造可被公开回调入口验证的沙箱请求。 */
export function buildSandboxNotifyRequest(input: BuildSandboxNotifyRequestInput): {
  body: string;
  headers: Headers;
} {
  const { secret, ...rest } = input;
  if (!secret) throw new Error('sandbox notify secret is required');
  const timestamp = input.timestamp ?? Math.floor(Date.now() / 1000);
  const body = buildSandboxNotifyBody({
    ...rest,
    timestamp,
    providerEventId: input.providerEventId ?? `sandbox-${randomUUID()}`,
    currency: input.currency ?? 'CNY',
  });
  return {
    body,
    headers: new Headers({
      'Content-Type': 'application/json',
      [SANDBOX_NOTIFY_TIMESTAMP_HEADER]: String(timestamp),
      [SANDBOX_NOTIFY_SIGNATURE_HEADER]: signSandboxNotify(secret, timestamp, body),
    }),
  };
}

/**
 * 尝试按沙箱协议解析回调。
 * 返回 null 表示不适用（非沙箱配置或未携带沙箱签名头），调用方继续走真实渠道验签；
 * 返回 NotifyResult 时即为最终结果（valid=false 表示报文不合法，ACK 400 拒收）。
 */
export function trySandboxNotify(
  ctx: AdapterContext,
  rawBody: string,
  headers: Headers,
  successAck: NotifyResult['ack'],
): NotifyResult | null {
  if (!ctx.config.sandbox) return null;
  const timestampHeader = headers.get(SANDBOX_NOTIFY_TIMESTAMP_HEADER);
  const signature = headers.get(SANDBOX_NOTIFY_SIGNATURE_HEADER);
  if (!timestampHeader && !signature) return null;

  const invalidAck: NotifyResult['ack'] = { body: 'invalid sandbox notify', contentType: 'text/plain', status: 400 };
  const invalid = (message: string, scene: NotifyResult['scene'] = 'payment'): NotifyResult => ({
    valid: false,
    scene,
    tradeStatus: 'unknown',
    ack: invalidAck,
    message,
  });
  if (!timestampHeader || !signature) return invalid('沙箱回调缺少时间戳或签名');
  const secret = ctx.secrets.sandboxNotifySecret;
  if (!secret) return invalid('沙箱回调密钥未配置');
  const timestamp = Number(timestampHeader);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(timestamp) || Math.abs(now - timestamp) > SANDBOX_TIMESTAMP_WINDOW_SECONDS) {
    return invalid('沙箱回调时间戳已过期');
  }
  const expectedSignature = signSandboxNotify(secret, timestamp, rawBody);
  if (!signatureMatches(signature, expectedSignature)) return invalid('沙箱回调签名无效');

  let data: Partial<SandboxNotifyPayload>;
  try {
    data = JSON.parse(rawBody) as Partial<SandboxNotifyPayload>;
  } catch {
    return invalid('沙箱回调报文解析失败（须为 JSON）');
  }
  if (data.sandbox !== true || (data.scene !== 'payment' && data.scene !== 'refund')) {
    return invalid('沙箱回调报文缺少 sandbox/scene 标记');
  }
  if (data.channelConfigId !== ctx.config.id) {
    return invalid('沙箱回调与渠道配置不匹配', data.scene);
  }
  if (data.timestamp !== timestamp) {
    return invalid('沙箱回调时间戳与签名头不一致', data.scene);
  }
  if (typeof data.providerEventId !== 'string' || !data.providerEventId.trim()) {
    return invalid('沙箱回调缺少 providerEventId', data.scene);
  }
  if (typeof data.currency !== 'string' || !/^[A-Z]{3}$/.test(data.currency)) {
    return invalid('沙箱回调币种不合法', data.scene);
  }
  if (!SANDBOX_TRADE_STATUSES.includes(data.tradeStatus as (typeof SANDBOX_TRADE_STATUSES)[number])) {
    return invalid(`沙箱回调 tradeStatus 不合法：${String(data.tradeStatus)}`, data.scene);
  }
  if (data.scene === 'payment' && !data.outTradeNo) {
    return invalid('支付回调缺少 outTradeNo', data.scene);
  }
  if (data.scene === 'refund' && !data.outRefundNo) {
    return invalid('退款回调缺少 outRefundNo', data.scene);
  }
  if (data.paidAt && !parseDateTimeInput(data.paidAt)) {
    return invalid('沙箱回调 paidAt 格式不合法', data.scene);
  }
  return {
    valid: true,
    scene: data.scene,
    ack: successAck,
    providerEventId: data.providerEventId,
    merchantId: data.merchantId,
    providerAppId: data.providerAppId,
    currency: data.currency,
    outTradeNo: data.outTradeNo,
    outRefundNo: data.outRefundNo,
    channelTradeNo: data.channelTradeNo,
    channelRefundNo: data.channelRefundNo,
    tradeStatus: data.tradeStatus as NotifyResult['tradeStatus'],
    paidAmount: typeof data.paidAmount === 'number' ? data.paidAmount : undefined,
    paidAt: data.paidAt ? (parseDateTimeInput(data.paidAt) ?? undefined) : undefined,
    raw: data,
  };
}
