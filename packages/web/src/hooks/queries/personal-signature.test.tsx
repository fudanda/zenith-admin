import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { authContract } from '@arcbase/shared/identity';
import type { ApiClient } from '@/lib/contract-query';
import { ApiRecorder, createRequestMock, createTestQueryClient, createWrapper } from '@/test-utils/query-harness';
import { SIGNATURE_TEST_PNG } from '@/test-utils/signature';
const recorder = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => recorder) }));
import { useMySignature, useSaveMySignature, useDeleteMySignature } from './personal-signature';
import { SignatureClientProvider } from '@/components/signature/SignatureClientContext';

beforeEach(() => recorder.reset());
const saved = { id: 1, version: 2, dataUrl: SIGNATURE_TEST_PNG, updatedAt: '2026-09-15 12:00:00' };
describe('个人签名缓存与会话', () => {
  it('保存和删除同步所有已挂载选择器，只更新个人签名缓存', async () => {
    recorder.on('GET', authContract.mySignature.fullPath, { ...saved, version: 1 });
    recorder.on('PUT', authContract.saveMySignature.fullPath, saved);
    recorder.on('DELETE', authContract.deleteMySignature.fullPath, null);
    const qc = createTestQueryClient();
    const { result } = renderHook(() => ({ first: useMySignature(), second: useMySignature(), save: useSaveMySignature(), remove: useDeleteMySignature() }), { wrapper: createWrapper(qc) });
    await waitFor(() => expect(result.current.first.isSuccess && result.current.second.isSuccess).toBe(true));
    recorder.resetCalls();
    await result.current.save.mutateAsync({ body: { dataUrl: SIGNATURE_TEST_PNG } });
    await waitFor(() => expect(result.current.second.data?.version).toBe(2));
    expect(result.current.first.data?.version).toBe(2);
    expect(recorder.countOf('GET', authContract.mySignature.fullPath)).toBe(0);
    await result.current.remove.mutateAsync({});
    await waitFor(() => expect(result.current.first.data).toBeNull());
    expect(result.current.second.data).toBeNull();
  });
  it('移动页面使用提供的独立请求客户端，不发送管理员客户端请求', async () => {
    const mobile = new ApiRecorder().on('GET', authContract.mySignature.fullPath, saved);
    const Wrapper = createWrapper(createTestQueryClient());
    const client = createRequestMock(() => mobile) as ApiClient;
    const { result } = renderHook(() => useMySignature(), { wrapper: ({ children }) => <Wrapper><SignatureClientProvider client={client}>{children}</SignatureClientProvider></Wrapper> });
    await waitFor(() => expect(result.current.data?.id).toBe(1));
    expect(mobile.countOf('GET', authContract.mySignature.fullPath)).toBe(1);
    expect(recorder.calls).toHaveLength(0);
  });
});
