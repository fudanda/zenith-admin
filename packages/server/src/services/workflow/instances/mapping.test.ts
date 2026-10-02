import { describe, expect, it } from 'vitest';
import { mapInstance } from './mapping';
import type { workflowInstances } from '../../../db/schema';
import type { WorkflowDefinitionSnapshot } from '@arcbase/shared/workflow';

type InstanceRow = typeof workflowInstances.$inferSelect;

function makeSnapshot(): WorkflowDefinitionSnapshot {
  return {
    id: 1,
    name: '外部集成流程',
    description: null,
    categoryId: null,
    formId: null,
    formType: 'designer',
    customForm: null,
    status: 'published',
    version: 1,
    tenantId: null,
    flowData: {
      nodes: [
        { id: 'n1', data: { key: 'start', label: '发起', type: 'start' } },
        {
          id: 'n2',
          data: {
            key: 'ext1',
            label: '外部审批',
            type: 'approve',
            externalApproval: { enabled: true, url: 'https://partner.example.com/approve', secret: 'top-secret-hmac', signMode: 'hmacSha256' },
          },
        },
        {
          id: 'n3',
          data: {
            key: 'trigger1',
            label: '回调触发器',
            type: 'trigger',
            triggerConfig: {
              triggerType: 'callback',
              webhookUrl: 'https://partner.example.com/hook',
              headers: { Authorization: 'Bearer outbound-token' },
              callbackSignMode: 'hmacSha256',
              callbackSecret: 'callback-secret',
            },
            nodeListeners: [
              { type: 'webhook', url: 'https://ops.example.com/listen', headers: { 'X-Api-Key': 'listener-key' }, events: ['onApprove'] },
            ],
          },
        },
      ],
      edges: [],
    },
  } as unknown as WorkflowDefinitionSnapshot;
}

function makeRow(snapshot: WorkflowDefinitionSnapshot): InstanceRow {
  return {
    id: 100,
    definitionId: 1,
    definitionSnapshot: snapshot,
    formSnapshot: null,
    title: '测试实例',
    serialNo: null,
    formData: {},
    status: 'running',
    priority: 'normal',
    currentNodeKey: 'ext1',
    initiatorId: 1,
    tenantId: null,
    parentInstanceId: null,
    parentTaskId: null,
    parentTaskItemKey: null,
    parentTaskItemIndex: null,
    bizType: null,
    bizId: null,
    suspendedAt: null,
    suspendReason: null,
    createdBy: null,
    updatedBy: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  } as unknown as InstanceRow;
}

type SnapshotDto = { flowData: { nodes: Array<{ data: Record<string, unknown> }> } };

describe('mapInstance definitionSnapshot 脱敏', () => {
  it('剥离外部审批/触发器回调密钥与出站凭证请求头，保留非敏感配置', () => {
    const dto = mapInstance(makeRow(makeSnapshot()), { includeDefinitionSnapshot: true }) as ReturnType<typeof mapInstance> & { definitionSnapshot: SnapshotDto };
    const nodes = dto.definitionSnapshot.flowData.nodes;

    const ext = nodes[1].data.externalApproval as { enabled: boolean; url: string; secret: string };
    expect(ext.secret).toBe('');
    expect(ext.enabled).toBe(true);
    expect(ext.url).toBe('https://partner.example.com/approve');

    const trigger = nodes[2].data.triggerConfig as Record<string, unknown>;
    expect(trigger.callbackSecret).toBeUndefined();
    expect(trigger.headers).toBeUndefined();
    expect(trigger.triggerType).toBe('callback');
    expect(trigger.webhookUrl).toBe('https://partner.example.com/hook');

    const listeners = nodes[2].data.nodeListeners as Array<Record<string, unknown>>;
    expect(listeners[0].headers).toBeUndefined();
    expect(listeners[0].url).toBe('https://ops.example.com/listen');
  });

  it('不修改数据库行内的原始快照（回调验签/作业派发仍可读取密钥）', () => {
    const snapshot = makeSnapshot();
    mapInstance(makeRow(snapshot), { includeDefinitionSnapshot: true });

    const rawNodes = snapshot.flowData!.nodes;
    expect((rawNodes[1].data.externalApproval as { secret: string }).secret).toBe('top-secret-hmac');
    const rawTrigger = rawNodes[2].data.triggerConfig as { callbackSecret?: string; headers?: Record<string, string> };
    expect(rawTrigger.callbackSecret).toBe('callback-secret');
    expect(rawTrigger.headers).toEqual({ Authorization: 'Bearer outbound-token' });
    expect(rawNodes[2].data.nodeListeners?.[0].headers).toEqual({ 'X-Api-Key': 'listener-key' });
  });

  it('默认（不含快照）不下发 definitionSnapshot', () => {
    const dto = mapInstance(makeRow(makeSnapshot())) as Record<string, unknown>;
    expect(dto.definitionSnapshot).toBeUndefined();
  });
});
