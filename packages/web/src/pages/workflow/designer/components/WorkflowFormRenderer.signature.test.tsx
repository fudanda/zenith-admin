import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form';
import type { WorkflowFormField } from '@arcbase/shared/workflow';
import type { SignatureInput, SignatureSnapshot } from '@arcbase/shared/core';
import WorkflowFormRenderer from './WorkflowFormRenderer';

const IMAGE = 'data:image/png;base64,c2lnbmF0dXJl';
vi.mock('@/components/signature/SignatureField', () => ({
  default: ({ onChange }: { onChange?: (input: SignatureInput) => void }) => <button onClick={() => onChange?.({ source: 'saved', signatureId: 8, version: 2 })}>使用个人签名</button>,
}));
vi.mock('@/components/SignaturePad', () => ({
  default: ({ onChange }: { onChange?: (input: string) => void }) => <button onClick={() => onChange?.('data:image/png;base64,c2lnbmF0dXJl')}>手写图片</button>,
}));

const fields: WorkflowFormField[] = [{ key: 'sign', label: '签名', type: 'signature', required: true, signaturePolicy: 'reusable' }];

describe('signature domain contracts in the shared form renderer', () => {
  it('submits a personal-signature reference in workflow mode', async () => {
    let api: FormApi | undefined;
    render(<WorkflowFormRenderer fields={fields} getFormApi={(value) => { api = value; }} />);
    fireEvent.click(await screen.findByRole('button', { name: '使用个人签名' }));
    await waitFor(() => expect(api?.getValue('sign')).toEqual({ source: 'saved', signatureId: 8, version: 2 }));
    expect(screen.queryByRole('button', { name: '手写图片' })).toBeNull();
  });

  it('keeps the report image contract and never loads the personal-signature control', async () => {
    let api: FormApi | undefined;
    render(<WorkflowFormRenderer signatureMode="image" fields={fields} getFormApi={(value) => { api = value; }} />);
    fireEvent.click(screen.getByRole('button', { name: '手写图片' }));
    await waitFor(() => expect(api?.getValue('sign')).toBe(IMAGE));
    expect(screen.queryByRole('button', { name: '使用个人签名' })).toBeNull();
  });

  it('renders the immutable workflow snapshot image and the report PNG through their explicit modes', () => {
    const snapshot: SignatureSnapshot = { dataUrl: IMAGE, source: 'saved', signerId: 1, signerName: '审批人', signedAt: '2026-09-15 12:00:00', signatureId: 8, signatureVersion: 2 };
    const view = render(<WorkflowFormRenderer fields={fields} readOnly initValues={{ sign: snapshot }} />);
    expect(screen.getByRole('img', { name: '签名' }).getAttribute('src')).toBe(IMAGE);
    view.unmount();
    render(<WorkflowFormRenderer signatureMode="image" fields={fields} readOnly initValues={{ sign: IMAGE }} />);
    expect(screen.getByRole('img', { name: '签名' }).getAttribute('src')).toBe(IMAGE);
  });
});
