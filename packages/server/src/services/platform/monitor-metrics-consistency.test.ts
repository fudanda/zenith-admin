/**
 * 监控告警指标的静态一致性校验。
 *
 * 指标此前在 4 处各写一份（pgEnum / Zod / 服务端标签表 / 前端标签表），
 * 任何一处漏改都不会报错，只会表现为「下拉里没有这个指标」或「告警消息显示成裸英文 key」。
 * 收敛到 MONITOR_METRICS 后，把「所有派生物必须覆盖全集」这条约定固化成可执行断言。
 */
import { describe, it, expect } from 'vitest';
import {
  MONITOR_METRICS,
  MONITOR_METRIC_META,
  MONITOR_METRIC_GROUPS,
  MONITOR_METRIC_GROUPED_OPTIONS,
  createMonitorAlertRuleSchema,
  formatMonitorMetricValue,
  type MonitorMetric,
} from '@arcbase/shared/platform';
import { SEED_MONITOR_ALERT_RULES } from '@arcbase/shared/seed';
import { monitorMetricEnum } from '../../db/schema';

describe('监控告警指标一致性', () => {
  it('指标集合无重复', () => {
    expect(new Set(MONITOR_METRICS).size).toBe(MONITOR_METRICS.length);
  });

  it('pgEnum 与 MONITOR_METRICS 完全一致（DB 写入不会因未登记的枚举值失败）', () => {
    expect([...monitorMetricEnum.enumValues].sort()).toEqual([...MONITOR_METRICS].sort());
  });

  it('创建规则的 Zod schema 接受全部指标', () => {
    for (const metric of MONITOR_METRICS) {
      const parsed = createMonitorAlertRuleSchema.safeParse({
        name: `规则-${metric}`,
        metric,
        threshold: 1,
        channels: ['inapp'],
        recipientUserIds: [1],
        recipientEmails: [],
      });
      expect(parsed.success, `指标 ${metric} 未被 schema 接受`).toBe(true);
    }
  });

  it('每个指标都有完整元信息，且分组合法', () => {
    for (const metric of MONITOR_METRICS) {
      const meta = MONITOR_METRIC_META[metric];
      expect(meta, `指标 ${metric} 缺少元信息`).toBeTruthy();
      expect(meta.label.trim()).not.toBe('');
      expect(meta.description.trim()).not.toBe('');
      expect(MONITOR_METRIC_GROUPS).toContain(meta.group);
    }
  });

  it('分组下拉覆盖全部指标且不重复（漏掉的指标在界面上无法被选中）', () => {
    const flattened = MONITOR_METRIC_GROUPED_OPTIONS.flatMap((g) => g.children.map((c) => c.value));
    expect(new Set(flattened).size).toBe(flattened.length);
    expect([...flattened].sort()).toEqual([...MONITOR_METRICS].sort());
  });

  it('数值格式化对每个指标都产出带单位/可读的文本，不回退成裸数字', () => {
    for (const metric of MONITOR_METRICS) {
      expect(formatMonitorMetricValue(metric, 12.345), `指标 ${metric} 格式化异常`).not.toBe('12.345');
    }
  });

  it('比率型指标按百分比格式化，吞吐型按字节速率格式化', () => {
    expect(formatMonitorMetricValue('paymentFailureRate', 31.44)).toBe('31.4%');
    expect(formatMonitorMetricValue('paymentReconDiff', 3)).toBe('3 项');
    expect(formatMonitorMetricValue('netRxBps', 1024 * 1024)).toBe('1 MB/s');
  });
});

describe('SEED_MONITOR_ALERT_RULES', () => {
  it('seed id 无重复（DB 主键安全）', () => {
    const ids = SEED_MONITOR_ALERT_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('引用的指标全部登记在 MONITOR_METRICS 中', () => {
    const known = new Set<string>(MONITOR_METRICS);
    for (const rule of SEED_MONITOR_ALERT_RULES) {
      expect(known.has(rule.metric), `种子规则「${rule.name}」引用了未登记指标 ${rule.metric}`).toBe(true);
    }
  });

  it('每条种子规则都能通过创建校验（启用时必须有可送达的渠道）', () => {
    for (const rule of SEED_MONITOR_ALERT_RULES) {
      const parsed = createMonitorAlertRuleSchema.safeParse(rule);
      expect(parsed.success, `种子规则「${rule.name}」未通过校验`).toBe(true);
    }
  });

  it('覆盖支付与开放平台两个业务域，而不只是基础设施', () => {
    const groups = new Set(SEED_MONITOR_ALERT_RULES.map((r) => MONITOR_METRIC_META[r.metric as MonitorMetric].group));
    expect(groups).toContain('payment');
    expect(groups).toContain('openPlatform');
  });
});
