import { afterEach, describe, expect, it } from 'vitest';
import type { AnyOperation } from '@arcbase/shared/core';
import { workflowDefinitionContract, workflowInstanceContract, workflowTaskContract, workflowTemplateContract, type WorkflowTask } from '@arcbase/shared/workflow';
import { mockWorkflowDefinitions, mockWorkflowInstances, mockWorkflowTasks } from './data/workflow';
import { mockWorkflowForms } from './data/workflow-forms';
import { workflowHandlers } from './handlers/workflow';
import { workflowExtraHandlers } from './handlers/workflow-extra';
import { mockAccessToken } from './utils/auth';
import { deleteMockMySignature, saveMockMySignature } from './utils/personal-signature';

const IMAGE = 'data:image/png;base64,c2lnbmF0dXJl';
const headers = { 'content-type': 'application/json', authorization: `Bearer ${mockAccessToken('admin')}` };
const actorRequest = () => new Request(window.location.origin, { headers });
const stores = [mockWorkflowDefinitions, mockWorkflowInstances, mockWorkflowTasks, mockWorkflowForms];
const initial = stores.map((store) => structuredClone(store));
afterEach(() => {
  stores.forEach((store, index) => { (store as unknown[]).splice(0, store.length, ...structuredClone(initial[index])); });
  deleteMockMySignature(actorRequest());
});

async function call(operation: AnyOperation, body: unknown, params: Record<string, number> = {}) {
  let path = operation.fullPath;
  for (const [key, value] of Object.entries(params)) path = path.replace(`{${key}}`, String(value));
  for (const handler of [...workflowExtraHandlers, ...workflowHandlers]) {
    const request = new Request(new URL(path, window.location.origin), { method: operation.method.toUpperCase(), headers, body: JSON.stringify(body) });
    const result = await (handler as unknown as { run(args: unknown): Promise<{ response?: Response } | null> }).run({ request, requestId: `signature-${crypto.randomUUID()}` });
    if (result?.response) return { status: result.response.status, body: await result.response.json() };
  }
  throw new Error(`No handler for ${path}`);
}

function task(id: number, signaturePolicy: NonNullable<WorkflowTask['signaturePolicy']>) {
  const instance = { ...structuredClone(mockWorkflowInstances[0]), id, status: 'running' as const, tasks: [] };
  const pending = { ...structuredClone(mockWorkflowTasks[0]), id, instanceId: id, nodeKey: 'signature-test', assigneeId: 1, status: 'pending' as const, signaturePolicy, signature: null, signatureEvidence: null };
  mockWorkflowInstances.push(instance);
  mockWorkflowTasks.push(pending);
  return pending;
}

describe('workflow signature contracts in Demo', () => {
  it('creates the signature example with its own form schema and an initiator task', async () => {
    const saved = saveMockMySignature(actorRequest(), IMAGE);
    const cloned = await call(workflowTemplateContract.clone, { name: '个人签名验证' }, { id: 9 });
    expect(cloned.status).toBe(200);
    expect(cloned.body.data.formFields.find((field: { key: string }) => field.key === 'applicantSignature')).toMatchObject({ type: 'signature', signaturePolicy: 'reusable' });
    const preview = await call(workflowDefinitionContract.preview, { formData: {} }, { id: cloned.body.data.id });
    expect(preview.body.data.filter((node: { nodeType: string }) => node.nodeType !== 'start')).toMatchObject([{ nodeKey: 'approve_signature', approvers: [{ id: 1 }] }]);
    expect(preview.body.data.some((node: { selectionRequired?: boolean }) => node.selectionRequired)).toBe(false);
    mockWorkflowDefinitions.find((item) => item.id === cloned.body.data.id)!.status = 'published';
    const created = await call(workflowInstanceContract.create, { definitionId: cloned.body.data.id, title: '个人签名验证', formData: {
      subject: '签名测试', applicantSignature: { source: 'saved', signatureId: saved.id, version: saved.version },
    } });
    expect(created.body.data.tasks[0]).toMatchObject({ assigneeId: 1, signaturePolicy: 'reusable' });
    expect(created.body.data.formData.applicantSignature).toMatchObject({ signerId: 1, dataUrl: IMAGE });
  });
  it('signs reusable items individually, leaves none items unsigned and reports handwritten items as excluded', async () => {
    const saved = saveMockMySignature(actorRequest(), IMAGE);
    task(99001, 'none'); task(99002, 'reusable'); task(99003, 'handwritten');
    const response = await call(workflowTaskContract.batchApprove, { taskIds: [99001, 99002, 99003], signature: { source: 'saved', signatureId: saved.id, version: saved.version } });
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ succeeded: 2, failed: 1, results: [{ taskId: 99001, success: true }, { taskId: 99002, success: true }, { taskId: 99003, success: false }] });
    expect(mockWorkflowTasks.find((item) => item.id === 99001)).toMatchObject({ signature: null, signatureEvidence: null });
    expect(mockWorkflowTasks.find((item) => item.id === 99002)).toMatchObject({ signature: IMAGE, signatureEvidence: { source: 'saved', signerId: 1, signatureId: saved.id, signatureVersion: saved.version } });
    expect(mockWorkflowTasks.find((item) => item.id === 99003)?.status).toBe('pending');
  });

  it('keeps an expired-template failure pending and accepts a newly confirmed version', async () => {
    const old = saveMockMySignature(actorRequest(), IMAGE);
    const current = saveMockMySignature(actorRequest(), IMAGE);
    task(99004, 'reusable');
    const failed = await call(workflowTaskContract.batchApprove, { taskIds: [99004], signature: { source: 'saved', signatureId: old.id, version: old.version } });
    expect(failed.body.data.failed).toBe(1);
    expect(failed.body.data.results[0].message).toContain('变更');
    expect(mockWorkflowTasks.find((item) => item.id === 99004)?.status).toBe('pending');
    const passed = await call(workflowTaskContract.batchApprove, { taskIds: [99004], signature: { source: 'saved', signatureId: current.id, version: current.version } });
    expect(passed.body.data.succeeded).toBe(1);
  });

  it('enforces handwritten policy for a single task and records the authenticated signer', async () => {
    const saved = saveMockMySignature(actorRequest(), IMAGE);
    task(99005, 'handwritten');
    const failed = await call(workflowTaskContract.approve, { signature: { source: 'saved', signatureId: saved.id, version: saved.version } }, { taskId: 99005 });
    expect(failed.status).toBe(400);
    const passed = await call(workflowTaskContract.approve, { signature: { source: 'drawn', dataUrl: IMAGE } }, { taskId: 99005 });
    expect(passed.status).toBe(200);
    expect(mockWorkflowTasks.find((item) => item.id === 99005)).toMatchObject({ signature: IMAGE, signatureEvidence: { source: 'drawn', signerId: 1, signatureId: null, signatureVersion: null } });
  });

  it('materializes form signatures, rejects forged snapshots and clears evidence in a new application', async () => {
    const saved = saveMockMySignature(actorRequest(), IMAGE);
    const definition = { ...structuredClone(mockWorkflowDefinitions[0]), id: 99100, formId: 99100, status: 'published' as const, formType: 'designer' as const };
    mockWorkflowDefinitions.push(definition);
    mockWorkflowForms.push({ ...structuredClone(mockWorkflowForms[0]), id: 99100, schema: { fields: [{ key: 'sign', label: '签名', type: 'signature', required: false, signaturePolicy: 'reusable' }] } });
    const created = await call(workflowInstanceContract.create, { definitionId: definition.id, title: '签名表单', asDraft: true, formData: { sign: { source: 'saved', signatureId: saved.id, version: saved.version } } });
    expect(created.status).toBe(200);
    const { id, formData } = created.body.data;
    expect(formData.sign).toMatchObject({ dataUrl: IMAGE, signerId: 1, source: 'saved', signatureVersion: saved.version });
    expect((await call(workflowInstanceContract.updateDraft, { formData }, { id })).status).toBe(200);
    expect((await call(workflowInstanceContract.updateDraft, { formData: { sign: { ...formData.sign, signerName: '伪造人' } } }, { id })).status).toBe(400);
    mockWorkflowInstances.find((item) => item.id === id)!.status = 'approved';
    const resubmitted = await call(workflowInstanceContract.resubmit, {}, { id });
    expect(resubmitted.body.data.formData).toEqual({});
  });
});
