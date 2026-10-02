import { describe, expect, it } from 'vitest';
import type { WorkflowFormSchema } from '@arcbase/shared/workflow';
import {
  validateReportFillSchema,
  validateReportFillValues,
} from './report-fill-validation';

function schema(fields: WorkflowFormSchema['fields']): WorkflowFormSchema {
  return { fields };
}

describe('report fill schema validation', () => {
  it('rejects duplicate, reserved and unsupported field definitions', () => {
    expect(() => validateReportFillSchema(schema([
      { key: 'name', label: '名称', type: 'text' },
      { key: 'name', label: '重复名称', type: 'text' },
    ]))).toThrow('重复');
    expect(() => validateReportFillSchema(schema([
      { key: 'status', label: '状态', type: 'text' },
    ]))).toThrow('保留');
    expect(() => validateReportFillSchema(schema([
      { key: 'secret', label: '密码', type: 'password' },
    ]))).toThrow('不支持');
  });

  it('validates required, range, regex, option and unknown values server-side', () => {
    const form = schema([
      { key: 'name', label: '名称', type: 'text', required: true, pattern: '^[A-Z]+$' },
      { key: 'score', label: '分数', type: 'number', min: 1, max: 10 },
      { key: 'kind', label: '类型', type: 'select', options: ['A', 'B'] },
      { key: 'day', label: '日期', type: 'date' },
    ]);
    expect(() => validateReportFillValues(form, {})).toThrow('不能为空');
    expect(() => validateReportFillValues(form, {
      name: 'ABC', score: 11, kind: 'A', day: '2026-03-01',
    })).toThrow('不能大于');
    expect(() => validateReportFillValues(form, {
      name: 'abc', score: 5, kind: 'A', day: '2026-03-01',
    })).toThrow('格式不正确');
    expect(() => validateReportFillValues(form, {
      name: 'ABC', score: 5, kind: 'C', day: '2026-03-01',
    })).toThrow('无效选项');
    expect(() => validateReportFillValues(form, {
      name: 'ABC', score: 5, kind: 'A', day: 'bad',
    })).toThrow('有效日期');
    expect(() => validateReportFillValues(form, {
      name: 'ABC', score: 5, kind: 'A', day: '2026-03-01', injected: true,
    })).toThrow('未声明字段');
  });

  it('validates month-granularity date fields by their declared dateFormat', () => {
    const form = schema([
      { key: 'period', label: '统计月份', type: 'date', dateFormat: 'YYYY-MM', required: true },
    ]);
    expect(validateReportFillValues(form, { period: '2026-08' })).toEqual({ period: '2026-08' });
    expect(() => validateReportFillValues(form, { period: '2026-08-01' })).toThrow('有效月份');
    expect(() => validateReportFillValues(form, { period: '2026-13' })).toThrow('有效月份');
    const dayForm = schema([
      { key: 'day', label: '日期', type: 'date', dateFormat: 'yyyy-MM-dd', required: true },
    ]);
    expect(validateReportFillValues(dayForm, { day: '2026-08-01' })).toEqual({ day: '2026-08-01' });
    expect(() => validateReportFillValues(dayForm, { day: '2026-08' })).toThrow('有效日期');
  });

  it('accepts valid values and returns only the declared shape', () => {
    const form = schema([
      { key: 'name', label: '名称', type: 'text', required: true },
      { key: 'enabled', label: '启用', type: 'switch' },
    ]);
    const values = { name: 'ArcBase', enabled: true };
    expect(validateReportFillValues(form, values)).toEqual(values);
  });

  it('skips hidden required fields and propagates hidden containers', () => {
    const form = schema([
      { key: 'kind', label: '类型', type: 'select', options: ['show', 'hide'], required: true },
      {
        key: 'conditional',
        label: '条件字段',
        type: 'text',
        required: true,
        visibilityCondition: { field: 'kind', operator: 'eq', value: 'show' },
      },
      {
        key: 'hiddenGroup',
        label: '隐藏分组',
        type: 'group',
        hidden: true,
        children: [{ key: 'nestedRequired', label: '分组必填', type: 'text', required: true }],
      },
      { key: 'alwaysHidden', label: '始终隐藏', type: 'text', hidden: true, required: true },
    ]);

    expect(validateReportFillValues(form, {
      kind: 'hide',
      conditional: '应被忽略',
      nestedRequired: '应被忽略',
      alwaysHidden: '应被忽略',
    })).toEqual({ kind: 'hide' });
    expect(() => validateReportFillValues(form, { kind: 'show' })).toThrow('条件字段');
    expect(validateReportFillValues(form, { kind: 'show', conditional: '可见值' }))
      .toEqual({ kind: 'show', conditional: '可见值' });
  });
});
