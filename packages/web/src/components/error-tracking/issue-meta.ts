/**
 * 错误监控 / 异常日志共用的纯常量与工具：颜色表、告警渠道归一、JSON 安全序列化。
 * 组件在 `issue-atoms.tsx`；两个页面（数据分析 → 错误监控、系统监控 → 异常日志）从这里导入，禁止各自再抄一份颜色表。
 */
import type { TagColor } from '@douyinfe/semi-ui/lib/es/tag/interface';
import type { ErrorAlertChannel, ErrorLevel, ErrorStatus, ErrorType } from '@arcbase/shared/analytics';
import { ERROR_ALERT_CHANNELS, ERROR_ALERT_CHANNEL_LABELS } from '@arcbase/shared/analytics';
import { enumValueOf } from '@arcbase/shared/core';

export const ERROR_TYPE_COLORS: Record<ErrorType, TagColor> = {
  js_error: 'red',
  promise_rejection: 'orange',
  resource_error: 'amber',
  console_error: 'grey',
  http_error: 'violet',
  white_screen: 'pink',
  crash: 'red',
  server_exception: 'red',
  job_failure: 'orange',
  cron_failure: 'amber',
  event_failure: 'violet',
  process_crash: 'red',
  logged_error: 'grey',
};

export const ERROR_LEVEL_COLORS: Record<ErrorLevel, TagColor> = {
  fatal: 'red',
  error: 'orange',
  warning: 'amber',
  info: 'blue',
};

export const ERROR_STATUS_COLORS: Record<ErrorStatus, TagColor> = {
  unresolved: 'red',
  resolved: 'green',
  ignored: 'grey',
  muted: 'blue',
};

export const ERROR_ALERT_CHANNEL_COLORS: Record<ErrorAlertChannel, TagColor> = {
  email: 'blue',
  webhook: 'violet',
  inapp: 'green',
};

/** 告警渠道取值收窄到契约枚举（列表实体与下拉控件的值都是宽 string） */
export function toAlertChannels(values: readonly unknown[]): ErrorAlertChannel[] {
  return values.flatMap((value) => {
    const channel = enumValueOf(ERROR_ALERT_CHANNELS, value);
    return channel ? [channel] : [];
  });
}

export function alertChannelMeta(channel: string): { label: string; color: TagColor } {
  const value = enumValueOf(ERROR_ALERT_CHANNELS, channel);
  return value
    ? { label: ERROR_ALERT_CHANNEL_LABELS[value], color: ERROR_ALERT_CHANNEL_COLORS[value] }
    : { label: channel, color: 'grey' };
}

export function safeJson(value: unknown): string {
  if (value === null || value === undefined) return '暂无';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
