import { describe, expect, it } from 'vitest';
import { sanitizeDetailFormDataForViewer } from './queries';
import type { WorkflowFlowData } from '@arcbase/shared/workflow';

type Row = Parameters<typeof sanitizeDetailFormDataForViewer>[0];

function makeFlow(perms: {
  start?: Record<string, 'hidden' | 'read' | 'edit'>;
  approve1?: Record<string, 'hidden' | 'read' | 'edit'>;
  approve2?: Record<string, 'hidden' | 'read' | 'edit'>;
}): WorkflowFlowData {
  return {
    nodes: [
      { id: 'n0', data: { key: 'start', label: '发起', type: 'start', ...(perms.start ? { fieldPermissions: perms.start } : {}) } },
      { id: 'n1', data: { key: 'approve1', label: '审批1', type: 'approve', ...(perms.approve1 ? { fieldPermissions: perms.approve1 } : {}) } },
      { id: 'n2', data: { key: 'approve2', label: '审批2', type: 'approve', ...(perms.approve2 ? { fieldPermissions: perms.approve2 } : {}) } },
    ],
    edges: [],
  } as unknown as WorkflowFlowData;
}

function makeRow(flow: WorkflowFlowData, opts: { initiatorId?: number; tasks?: Array<{ assigneeId: number | null; nodeKey: string }> } = {}): Row {
  return {
    formData: { salary: 50000, name: '张三', note: 'x' },
    initiatorId: opts.initiatorId ?? 1,
    definitionSnapshot: { flowData: flow },
    tasks: opts.tasks ?? [],
  };
}

describe('sanitizeDetailFormDataForViewer 读侧字段脱敏', () => {
  it('审批人：其节点 hidden 字段被剔除', () => {
    const row = makeRow(makeFlow({ approve1: { salary: 'hidden', name: 'read' } }), {
      tasks: [{ assigneeId: 9, nodeKey: 'approve1' }],
    });
    const out = sanitizeDetailFormDataForViewer(row, 9) as Record<string, unknown>;
    expect(out.salary).toBeUndefined();
    expect(out.name).toBe('张三');
    expect(out.note).toBe('x'); // 未配置的字段默认可见
  });

  it('查看者跨多节点：任一节点非 hidden 即可见', () => {
    const row = makeRow(makeFlow({
      approve1: { salary: 'hidden' },
      approve2: { salary: 'read' },
    }), {
      tasks: [
        { assigneeId: 9, nodeKey: 'approve1' },
        { assigneeId: 9, nodeKey: 'approve2' },
      ],
    });
    const out = sanitizeDetailFormDataForViewer(row, 9) as Record<string, unknown>;
    expect(out.salary).toBe(50000);
  });

  it('发起人：按 start 节点权限脱敏', () => {
    const row = makeRow(makeFlow({ start: { salary: 'hidden' } }), { initiatorId: 1 });
    const out = sanitizeDetailFormDataForViewer(row, 1) as Record<string, unknown>;
    expect(out.salary).toBeUndefined();
    expect(out.name).toBe('张三');
  });

  it('相关节点未配置 fieldPermissions 时返回全量（兼容旧流程）', () => {
    const row = makeRow(makeFlow({}), { tasks: [{ assigneeId: 9, nodeKey: 'approve1' }] });
    const out = sanitizeDetailFormDataForViewer(row, 9) as Record<string, unknown>;
    expect(out.salary).toBe(50000);
  });

  it('查看者与任何节点无关（祖先发起人等）返回全量', () => {
    const row = makeRow(makeFlow({ approve1: { salary: 'hidden' } }), { initiatorId: 1, tasks: [] });
    const out = sanitizeDetailFormDataForViewer(row, 999) as Record<string, unknown>;
    expect(out.salary).toBe(50000);
  });

  it('发起人同时是审批人：任一映射可见即可见', () => {
    const row = makeRow(makeFlow({
      start: { salary: 'hidden' },
      approve1: { salary: 'read' },
    }), {
      initiatorId: 1,
      tasks: [{ assigneeId: 1, nodeKey: 'approve1' }],
    });
    const out = sanitizeDetailFormDataForViewer(row, 1) as Record<string, unknown>;
    expect(out.salary).toBe(50000);
  });
});
