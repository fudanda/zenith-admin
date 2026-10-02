import { describe, it, expect } from 'vitest';
import { evalWorkflowFieldRuleGroup, collectWorkflowRuleConditions, isWorkflowRuleGroup } from '@arcbase/shared/workflow';
import type { WorkflowFieldVisibilityRuleGroup } from '@arcbase/shared/workflow';

describe('嵌套条件组求值（F07）', () => {
  const group: WorkflowFieldVisibilityRuleGroup = {
    logic: 'and',
    rules: [
      { field: 'type', operator: 'eq', value: '报销' },
      {
        logic: 'or',
        rules: [
          { field: 'amount', operator: 'gt', value: 1000 },
          { field: 'urgent', operator: 'eq', value: true },
        ],
      },
    ],
  };

  it('A 且 (B 或 C)：任一子条件满足即命中子组', () => {
    expect(evalWorkflowFieldRuleGroup(group, { type: '报销', amount: 2000, urgent: false })).toBe(true);
    expect(evalWorkflowFieldRuleGroup(group, { type: '报销', amount: 100, urgent: true })).toBe(true);
    expect(evalWorkflowFieldRuleGroup(group, { type: '报销', amount: 100, urgent: false })).toBe(false);
    expect(evalWorkflowFieldRuleGroup(group, { type: '请假', amount: 2000, urgent: true })).toBe(false);
  });

  it('空组与空子组恒真；扁平旧数据行为不变', () => {
    expect(evalWorkflowFieldRuleGroup({ logic: 'and', rules: [] }, {})).toBe(true);
    expect(evalWorkflowFieldRuleGroup({ logic: 'and', rules: [{ logic: 'or', rules: [] }] }, {})).toBe(true);
    const flat: WorkflowFieldVisibilityRuleGroup = { logic: 'or', rules: [{ field: 'a', operator: 'eq', value: 1 }] };
    expect(evalWorkflowFieldRuleGroup(flat, { a: 1 })).toBe(true);
    expect(evalWorkflowFieldRuleGroup(flat, { a: 2 })).toBe(false);
  });

  it('collectWorkflowRuleConditions 展平嵌套叶子条件', () => {
    const conditions = collectWorkflowRuleConditions(group);
    expect(conditions.map((c) => c.field)).toEqual(['type', 'amount', 'urgent']);
    expect(isWorkflowRuleGroup(group.rules[1])).toBe(true);
    expect(isWorkflowRuleGroup(group.rules[0])).toBe(false);
  });
});
