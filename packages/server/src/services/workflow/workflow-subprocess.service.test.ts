/**
 * 子流程纯逻辑单测（无 DB 依赖）：
 * - buildChildFormData：入参映射模板（{{form.x}} / {{item}} / {{item.prop}} / 字面量）
 * - resolveMultiItems：多实例循环数据源的归一化
 */
import { describe, it, expect } from 'vitest';
import type { WorkflowNodeConfig } from '@arcbase/shared/workflow';
import { buildChildFormData, resolveMultiItems } from './workflow-instances.service';

const parentForm = { title: '差旅报销', amount: 1280, name: '张三' };

describe('buildChildFormData', () => {
  it('单一引用 {{form.x}} 保留原值类型', () => {
    const out = buildChildFormData({ childAmount: '{{form.amount}}' }, parentForm);
    expect(out.childAmount).toBe(1280);
  });

  it('裸引用 {{x}} 等价于 {{form.x}}', () => {
    const out = buildChildFormData({ childTitle: '{{title}}' }, parentForm);
    expect(out.childTitle).toBe('差旅报销');
  });

  it('字符串插值拼接父字段', () => {
    const out = buildChildFormData({ summary: '{{form.name}} 的 {{form.title}}' }, parentForm);
    expect(out.summary).toBe('张三 的 差旅报销');
  });

  it('{{item}} 引用整个循环项', () => {
    const out = buildChildFormData({ who: '{{item}}' }, parentForm, 7);
    expect(out.who).toBe(7);
  });

  it('{{item.prop}} 取循环项对象属性', () => {
    const out = buildChildFormData({ amt: '{{item.amount}}' }, parentForm, { amount: 99, name: 'a' });
    expect(out.amt).toBe(99);
  });

  it('字面量值原样写入', () => {
    const out = buildChildFormData({ fixed: 'hello' }, parentForm);
    expect(out.fixed).toBe('hello');
  });

  it('未配置映射返回空对象', () => {
    expect(buildChildFormData(undefined, parentForm)).toEqual({});
  });
});

function cfg(source?: string): WorkflowNodeConfig {
  return { key: 'sp', type: 'subProcess', label: '子流程', subProcessMultiSource: source } as WorkflowNodeConfig;
}

describe('resolveMultiItems', () => {
  it('数组字段原样返回', () => {
    expect(resolveMultiItems(cfg('items'), { items: [1, 2, 3] })).toEqual([1, 2, 3]);
  });

  it('标量字段包装为单元素数组', () => {
    expect(resolveMultiItems(cfg('items'), { items: 5 })).toEqual([5]);
  });

  it('空字符串视为无数据', () => {
    expect(resolveMultiItems(cfg('items'), { items: '' })).toEqual([]);
  });

  it('null / 缺失字段视为无数据', () => {
    expect(resolveMultiItems(cfg('items'), { items: null })).toEqual([]);
    expect(resolveMultiItems(cfg('items'), {})).toEqual([]);
  });

  it('未配置循环源返回空数组', () => {
    expect(resolveMultiItems(cfg(undefined), { items: [1, 2] })).toEqual([]);
  });
});
