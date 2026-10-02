import { describe, expect, it } from 'vitest';
import { collectMissingRequiredFields, isWorkflowFieldRequired, isWorkflowFieldVisible } from '@arcbase/shared/workflow';
import type { WorkflowFormField } from '@arcbase/shared/workflow';

const f = (partial: Partial<WorkflowFormField> & { key: string }): WorkflowFormField => ({
  label: partial.key,
  type: 'text',
  ...partial,
} as WorkflowFormField);

describe('workflow-form-runtime 显隐/必填求值', () => {
  it('visibilityRules 优先于默认隐藏与旧版单条件', () => {
    const field = f({
      key: 'a',
      hidden: true,
      visibilityRules: { logic: 'and', rules: [{ field: 'type', operator: 'eq', value: 'x' }] },
    });
    expect(isWorkflowFieldVisible(field, { type: 'x' })).toBe(true);
    expect(isWorkflowFieldVisible(field, { type: 'y' })).toBe(false);
  });

  it('hidden 默认隐藏；visibilityCondition 兼容旧版', () => {
    expect(isWorkflowFieldVisible(f({ key: 'a', hidden: true }), {})).toBe(false);
    const legacy = f({ key: 'b', visibilityCondition: { field: 'n', operator: 'gt', value: 3 } });
    expect(isWorkflowFieldVisible(legacy, { n: 5 })).toBe(true);
    expect(isWorkflowFieldVisible(legacy, { n: 1 })).toBe(false);
  });

  it('requiredRules 条件必填', () => {
    const field = f({ key: 'reason', requiredRules: { logic: 'and', rules: [{ field: 'days', operator: 'gte', value: 3 }] } });
    expect(isWorkflowFieldRequired(field, { days: 5 })).toBe(true);
    expect(isWorkflowFieldRequired(field, { days: 1 })).toBe(false);
  });
});

describe('collectMissingRequiredFields 发起必填校验', () => {
  it('收集可见必填的空字段，忽略已填与不可见字段', () => {
    const fields = [
      f({ key: 'title', label: '标题', required: true }),
      f({ key: 'amount', label: '金额', type: 'amount', required: true }),
      f({
        key: 'reason', label: '事由', required: true,
        visibilityRules: { logic: 'and', rules: [{ field: 'type', operator: 'eq', value: 'special' }] },
      }),
    ];
    expect(collectMissingRequiredFields(fields, { title: '报销', type: 'normal' })).toEqual(['金额']);
    // type=special 时 reason 变为可见且必填
    expect(collectMissingRequiredFields(fields, { title: '报销', amount: 100, type: 'special' })).toEqual(['事由']);
  });

  it('下钻布局容器（row/tabs/group），布局自身不参与', () => {
    const fields = [
      f({
        key: 'r1', type: 'row',
        columns: [{ span: 12, fields: [f({ key: 'inner', label: '内部字段', required: true })] }],
      } as Partial<WorkflowFormField> & { key: string }),
    ];
    expect(collectMissingRequiredFields(fields, {})).toEqual(['内部字段']);
    expect(collectMissingRequiredFields(fields, { inner: 'ok' })).toEqual([]);
  });

  it('start 权限 hidden/read 的字段不参与必填（服务端已剔除其输入）', () => {
    const fields = [
      f({ key: 'a', label: 'A', required: true }),
      f({ key: 'b', label: 'B', required: true }),
    ];
    expect(collectMissingRequiredFields(fields, {}, { a: 'hidden', b: 'read' })).toEqual([]);
    expect(collectMissingRequiredFields(fields, {}, { a: 'edit' })).toEqual(['A', 'B']);
  });

  it('formula/serialNumber/只读字段与空数组值的判定', () => {
    const fields = [
      f({ key: 'auto', label: '公式', type: 'formula', required: true }),
      f({ key: 'sn', label: '流水号', type: 'serialNumber', required: true }),
      f({ key: 'ro', label: '只读', required: true, readOnly: true }),
      f({ key: 'files', label: '附件', type: 'attachment', required: true }),
    ];
    expect(collectMissingRequiredFields(fields, { files: [] })).toEqual(['附件']);
  });

  it('条件必填字段：规则满足才校验', () => {
    const fields = [
      f({ key: 'proof', label: '凭证', requiredRules: { logic: 'and', rules: [{ field: 'amount', operator: 'gt', value: 1000 }] } }),
    ];
    expect(collectMissingRequiredFields(fields, { amount: 2000 })).toEqual(['凭证']);
    expect(collectMissingRequiredFields(fields, { amount: 500 })).toEqual([]);
  });
});
