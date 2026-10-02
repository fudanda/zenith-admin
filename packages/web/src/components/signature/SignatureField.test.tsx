import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SignatureInput, SignatureSnapshot } from '@arcbase/shared/core';
import { SIGNATURE_TEST_PNG } from '@/test-utils/signature';

const state = vi.hoisted(() => ({ data: null as null | { id: number; version: number; dataUrl: string; updatedAt: string }, save: vi.fn() }));
vi.mock('@/hooks/queries/personal-signature', () => ({
  useMySignature: () => ({ data: state.data, isLoading: false, isSuccess: true, error: null, refetch: vi.fn() }),
  useSaveMySignature: () => ({ mutateAsync: state.save, isPending: false }),
}));
vi.mock('@/components/SignaturePad', () => ({ default: ({ onChange }: { onChange: (value: string) => void }) => <button onClick={() => onChange(SIGNATURE_TEST_PNG)}>模拟手写</button> }));
import SignatureField from './SignatureField';

beforeEach(() => {
  state.data = { id: 7, version: 3, dataUrl: SIGNATURE_TEST_PNG, updatedAt: '2026-09-15 10:00:00' };
  state.save.mockReset();
});
function Selection({ handwritten = false, savedOnly = false }: { handwritten?: boolean; savedOnly?: boolean }) {
  const [value, setValue] = useState<SignatureInput | null>(null);
  return <><SignatureField value={value} onChange={setValue} policy={handwritten ? 'handwritten' : 'reusable'} autoSelectSaved savedOnly={savedOnly} /><output>{JSON.stringify(value)}</output></>;
}

describe('签名选择', () => {
  it('审批预览默认选择本人当前版本，输出中不携带签署元数据', async () => {
    render(<Selection />);
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('{"source":"saved","signatureId":7,"version":3}'));
    expect(screen.getByAltText('本次使用的签名')).toHaveAttribute('src', SIGNATURE_TEST_PNG);
    fireEvent.click(screen.getByText('重新手写'));
    fireEvent.click(screen.getByText('模拟手写'));
    expect(screen.getByRole('status').textContent).toContain('"source":"drawn"');
  });
  it('必须手写时不自动引用个人签名', () => {
    render(<Selection handwritten />);
    expect(screen.queryByText('使用我的签名')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('null');
    expect(screen.getByText('模拟手写')).toBeInTheDocument();
  });
  it('批量缺少个人模板时不开放手写替代', () => {
    state.data = null;
    render(<Selection savedOnly />);
    expect(screen.queryByText('模拟手写')).toBeNull();
    expect(screen.getByText(/请先在个人中心/)).toBeInTheDocument();
    expect(screen.getByRole('status').textContent).toBe('null');
  });
  it('模板删除后，已有单据仍按其固化快照回显', () => {
    state.data = null;
    const snapshot: SignatureSnapshot = { dataUrl: SIGNATURE_TEST_PNG, source: 'saved', signerId: 1, signerName: '申请人', signedAt: '2026-09-15 10:00:00', signatureId: 7, signatureVersion: 3 };
    render(<SignatureField value={snapshot} disabled />);
    expect(screen.getByAltText('手写签名')).toHaveAttribute('src', SIGNATURE_TEST_PNG);
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('删除模板会清除过期的复用选择，批量不能继续提交', async () => {
    const view = render(<Selection savedOnly />);
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('"source":"saved"'));
    state.data = null;
    view.rerender(<Selection savedOnly />);
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('null'));
    expect(screen.queryByAltText('本次使用的签名')).toBeNull();
    expect(screen.getByText(/已保存的签名发生变更/)).toBeInTheDocument();
  });

});
