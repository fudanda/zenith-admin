/**
 * 统一失败策略解析纯函数单测（无 DB 依赖）。
 * 覆盖 resolveFailurePolicy 的兼容映射与显式策略优先级。
 */
import { describe, it, expect } from 'vitest';
import { resolveFailurePolicy } from '@arcbase/shared/workflow';
import type { WorkflowNodeConfig } from '@arcbase/shared/workflow';

const node = (over: Partial<WorkflowNodeConfig>): WorkflowNodeConfig => ({ key: 'n1', type: 'trigger', label: '节点', ...over });

describe('resolveFailurePolicy', () => {
  it('显式 failurePolicy 优先返回', () => {
    const p = resolveFailurePolicy(node({ failurePolicy: { action: 'compensate', compensation: { type: 'http', url: '/x' } } }));
    expect(p?.action).toBe('compensate');
    expect(p?.compensation?.type).toBe('http');
  });

  it('trigger.onFailure=continue → { action: continue }', () => {
    expect(resolveFailurePolicy(node({ type: 'trigger', triggerConfig: { triggerType: 'webhook', onFailure: 'continue' } }))).toEqual({ action: 'continue' });
  });

  it('trigger.onFailure=retry → 映射 maxRetries', () => {
    expect(resolveFailurePolicy(node({ type: 'trigger', triggerConfig: { triggerType: 'webhook', onFailure: 'retry', maxRetries: 5 } }))).toEqual({ action: 'retry', maxRetries: 5 });
  });

  it('trigger.onFailure=block → null（沿用异常边/catch）', () => {
    expect(resolveFailurePolicy(node({ type: 'trigger', triggerConfig: { triggerType: 'webhook', onFailure: 'block' } }))).toBeNull();
  });

  it('非 trigger 且无 failurePolicy → null', () => {
    expect(resolveFailurePolicy(node({ type: 'approve', triggerConfig: undefined }))).toBeNull();
  });

  it('空节点 → null', () => {
    expect(resolveFailurePolicy(null)).toBeNull();
    expect(resolveFailurePolicy(undefined)).toBeNull();
  });
});
