import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { bizLeaveContract } from '@arcbase/shared/biz';
import { cmsContentContract } from '@arcbase/shared/cms';
import { workflowInstanceContract } from '@arcbase/shared/workflow';
import { ApiRecorder, createRequestMock, createTestQueryClient, createWrapper, isFresh } from '@/test-utils/query-harness';

const recorder = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => recorder) }));
import { contractKey, urlOf, useApiQuery } from '@/lib/contract-query';
import { useBizLeaveDetail, useBizLeaveRecord, useBizLeaveWorkflowContext, useSaveBizLeave } from './biz-leave';
import { invalidateAfterInstanceChange } from './workflow-instances';

const leave = { id: 1, status: 'draft', workflowInstanceId: null };
const context = { instance: { id: 101, bizType: 'biz_leave', bizId: '1' }, previousInstances: [{ id: 101 }] };
beforeEach(() => {
  recorder.reset();
  for (const id of [1, 2]) {
    recorder.on('GET', urlOf(bizLeaveContract.detail, { params: { id } }), { ...leave, id });
    recorder.on('GET', urlOf(bizLeaveContract.approvalDetail, { params: { id }, query: { instanceId: 101 } }).split('?')[0], { ...leave, id });
    recorder.on('GET', urlOf(bizLeaveContract.workflowContext, { params: { id }, query: {} }), id === 1 ? context : { instance: null, previousInstances: [] });
  }
  recorder.on('PUT', urlOf(bizLeaveContract.update, { params: { id: 1 } }), leave);
});

describe('业务流程缓存一致性', () => {
  it('保存当前资料后，同一单据各审批轮次重新读取，其他单据保持新鲜', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(() => ({
      own: useBizLeaveRecord(1), old: useBizLeaveDetail('1', 101), recent: useBizLeaveDetail('1', 102),
      other: useBizLeaveDetail('2', 201), current: useBizLeaveWorkflowContext(1),
      history: useBizLeaveWorkflowContext(1, 101), save: useSaveBizLeave(),
    }), { wrapper: createWrapper(qc) });
    await waitFor(() => expect(result.current.own.isSuccess && result.current.old.isSuccess && result.current.recent.isSuccess
      && result.current.other.isSuccess && result.current.current.isSuccess && result.current.history.isSuccess).toBe(true));
    recorder.resetCalls();
    await result.current.save.mutateAsync({ id: 1, values: { reason: '修改事由' } });
    await waitFor(() => expect(recorder.calls.filter((c) => c.method === 'GET' && c.url.includes('/1/detail')).length).toBe(2));
    await waitFor(() => expect(recorder.calls.filter((c) => c.method === 'GET' && c.url.includes('/1/workflow')).length).toBe(2));
    expect(recorder.calls.some((c) => c.url.includes('/2/'))).toBe(false);
    expect(isFresh(qc, contractKey(bizLeaveContract.approvalDetail, { params: { id: 2 }, query: { instanceId: 201 } }))).toBe(true);
  });

  it('审批动作按实例关联刷新CMS列表、详情和流程，不影响别张单据', async () => {
    const qc = createTestQueryClient();
    qc.setQueryData(contractKey(workflowInstanceContract.detail, { params: { id: 301 } }), { id: 301, bizType: 'cms_content', bizId: '8' });
    const detail = cmsContentContract.detail;
    const workflow = cmsContentContract.workflowContext;
    recorder.on('GET', urlOf(detail, { params: { id: 8 } }), { id: 8 });
    recorder.on('GET', urlOf(detail, { params: { id: 9 } }), { id: 9 });
    recorder.on('GET', urlOf(workflow, { params: { id: 8 }, query: {} }), { instance: null, previousInstances: [] });
    const { result } = renderHook(() => ({
      current: useApiQuery(detail, { params: { id: 8 } }),
      other: useApiQuery(detail, { params: { id: 9 } }),
      context: useApiQuery(workflow, { params: { id: 8 }, query: {} }),
    }), { wrapper: createWrapper(qc) });
    await waitFor(() => expect(result.current.current.isSuccess && result.current.other.isSuccess && result.current.context.isSuccess).toBe(true));
    recorder.resetCalls();
    invalidateAfterInstanceChange(qc, 301);
    await waitFor(() => expect(recorder.calls.filter((c) => c.method === 'GET').length).toBe(2));
    expect(recorder.calls.some((c) => c.url.includes('/9'))).toBe(false);
    expect(isFresh(qc, contractKey(detail, { params: { id: 9 } }))).toBe(true);
  });
});
