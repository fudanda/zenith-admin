import { describe, expect, it } from 'vitest';
import { createReportAlertSchema, reportWidgetSchema } from '@arcbase/shared/report';
import { evaluateMetricAlertValue } from './report-alert.service';
import { buildMetricWidgetDataResult } from './report-dashboard.service';

describe('metric-backed report integrations', () => {
  it('validates metric-backed alert and dashboard source constraints', () => {
    expect(reportWidgetSchema.safeParse({
      i: 'kpi-1', type: 'kpi', title: '收入', metricId: 7, options: {},
    }).success).toBe(true);
    expect(reportWidgetSchema.safeParse({
      i: 'bar-1', type: 'bar', title: '收入', metricId: 7, options: {},
    }).success).toBe(false);
    expect(reportWidgetSchema.safeParse({
      i: 'kpi-2', type: 'kpi', title: '收入', metricId: 7, datasetId: 2, options: {},
    }).success).toBe(false);

    expect(createReportAlertSchema.safeParse({
      name: '收入预警', datasetId: null, metricId: 7, threshold: 100, channels: ['inApp'],
    }).success).toBe(true);
    expect(createReportAlertSchema.safeParse({
      name: '非法分组', metricId: 7, groupByField: 'dept', threshold: 100, channels: ['inApp'],
    }).success).toBe(false);
  });

  it('uses evaluated metric values for alert comparisons', () => {
    expect(evaluateMetricAlertValue(120, 'gte', 100)).toEqual({
      value: 120,
      triggered: true,
      hits: [],
    });
    expect(evaluateMetricAlertValue(99, 'gte', 100).triggered).toBe(false);
  });

  it('returns the standard dashboard widget result envelope', () => {
    expect(buildMetricWidgetDataResult({
      metricId: 7,
      code: 'revenue',
      value: 1234.5,
      formattedValue: '¥1,234.50',
      unit: '元',
      durationMs: 8,
      cacheHit: true,
    })).toEqual({
      data: {
        columns: ['value'],
        fields: [{ name: 'value', label: 'revenue', type: 'number' }],
        rows: [{ value: 1234.5, formattedValue: '¥1,234.50', unit: '元' }],
        total: 1,
      },
      error: null,
      durationMs: 8,
      cacheHit: true,
    });
  });
});
