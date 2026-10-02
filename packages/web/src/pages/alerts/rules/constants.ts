import type { MonitorAlertHandleStatus, MonitorAlertLevel, MonitorAlertNotifyStatus, MonitorMetric } from '@arcbase/shared/platform';
import {
  MONITOR_ALERT_HANDLE_STATUS_LABELS,
  MONITOR_ALERT_LEVEL_LABELS,
  MONITOR_ALERT_NOTIFY_STATUS_LABELS,
  MONITOR_METRIC_META,
} from '@arcbase/shared/platform';

// 告警指标标签 / 分组 / 单位的唯一来源是 `@arcbase/shared/platform` 的 MONITOR_METRIC_META，
// 本文件只做展示层的派生（单位归类、级别配色），不再复制一份中文映射。
export {
  MONITOR_METRIC_LABELS,
  MONITOR_METRIC_OPTIONS,
  MONITOR_METRIC_GROUPED_OPTIONS,
  MONITOR_METRIC_META,
  formatMonitorMetricValue,
} from '@arcbase/shared/platform';

export const MONITOR_PERCENT_METRICS = new Set<MonitorMetric>(
  (Object.keys(MONITOR_METRIC_META) as MonitorMetric[]).filter((m) => MONITOR_METRIC_META[m].unit === 'percent'),
);

export const MONITOR_BYTES_METRICS = new Set<MonitorMetric>(
  (Object.keys(MONITOR_METRIC_META) as MonitorMetric[]).filter((m) => MONITOR_METRIC_META[m].unit === 'bps'),
);

export const MONITOR_ALERT_LEVEL_CONFIG: Record<
  MonitorAlertLevel,
  { label: string; color: 'blue' | 'amber' | 'red' }
> & Record<string, { label: string; color: 'blue' | 'amber' | 'red' }> = {
  info: { label: MONITOR_ALERT_LEVEL_LABELS.info, color: 'blue' },
  warning: { label: MONITOR_ALERT_LEVEL_LABELS.warning, color: 'amber' },
  critical: { label: MONITOR_ALERT_LEVEL_LABELS.critical, color: 'red' },
};

/** 通知投递结果的展示配色：文案取自 shared，此处只做展示层派生 */
export const MONITOR_ALERT_NOTIFY_STATUS_CONFIG: Record<
  MonitorAlertNotifyStatus,
  { label: string; color: 'grey' | 'green' | 'amber' | 'red' }
> = {
  skipped: { label: MONITOR_ALERT_NOTIFY_STATUS_LABELS.skipped, color: 'grey' },
  success: { label: MONITOR_ALERT_NOTIFY_STATUS_LABELS.success, color: 'green' },
  partial: { label: MONITOR_ALERT_NOTIFY_STATUS_LABELS.partial, color: 'amber' },
  failed: { label: MONITOR_ALERT_NOTIFY_STATUS_LABELS.failed, color: 'red' },
};

/** 人工处理状态的展示配色 */
export const MONITOR_ALERT_HANDLE_STATUS_CONFIG: Record<
  MonitorAlertHandleStatus,
  { label: string; color: 'red' | 'blue' | 'green' }
> = {
  pending: { label: MONITOR_ALERT_HANDLE_STATUS_LABELS.pending, color: 'red' },
  acknowledged: { label: MONITOR_ALERT_HANDLE_STATUS_LABELS.acknowledged, color: 'blue' },
  closed: { label: MONITOR_ALERT_HANDLE_STATUS_LABELS.closed, color: 'green' },
};
