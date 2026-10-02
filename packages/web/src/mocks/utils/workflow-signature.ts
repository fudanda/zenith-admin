import type { SignatureInput } from '@arcbase/shared/core';
import { findNextApproverSelectNodes, mapWorkflowFormSignatures, WorkflowFormSignatureError, type WorkflowFormField, type WorkflowTask } from '@arcbase/shared/workflow';
import { mockWorkflowDefinitions, mockWorkflowInstances } from '../data/workflow';
import { MockHttpError } from './contract';
import { badRequest, forbidden } from './handlers';
import { resolveMockUserSignature } from './personal-signature';

export function mockTaskWorkflowContext(task: WorkflowTask) {
  const instance = mockWorkflowInstances.find((item) => item.id === task.instanceId);
  const flow = instance?.definitionSnapshot?.flowData
    ?? mockWorkflowDefinitions.find((item) => item.id === instance?.definitionId)?.flowData;
  const node = flow?.nodes.find((item) => item.data.key === task.nodeKey)?.data;
  return { instance, flow, node };
}

export function mockTaskSignaturePolicy(task: WorkflowTask) {
  return task.signaturePolicy ?? mockTaskWorkflowContext(task).node?.signaturePolicy ?? 'none';
}

export function resolveMockTaskSignature(request: Request, task: WorkflowTask, input: SignatureInput | undefined, batch = false): Pick<WorkflowTask, 'signature' | 'signatureEvidence'> {
  const { instance, flow, node } = mockTaskWorkflowContext(task);
  if (instance?.status !== 'running') throw new MockHttpError(badRequest('流程当前不能审批', { status: 400 }));
  const policy = mockTaskSignaturePolicy(task);
  if (batch && (policy === 'handwritten' || node?.actionButtons?.approve?.uploadMode === 'required'
    || (flow && findNextApproverSelectNodes(flow, task.nodeKey).length > 0))) {
    throw new MockHttpError(badRequest('该任务要求现场手写、上传附件或选择下一审批人，请单独审批', { status: 400 }));
  }
  if (policy === 'none') return { signature: null, signatureEvidence: null };
  if (!input) throw new MockHttpError(badRequest('请提供本次审批签名', { status: 400 }));
  if (batch && input.source !== 'saved') throw new MockHttpError(badRequest('批量签署仅可使用本人的个人签名', { status: 400 }));
  const { dataUrl, ...signatureEvidence } = resolveMockUserSignature(request, input, policy);
  if (task.assigneeId != null && task.assigneeId !== signatureEvidence.signerId) {
    throw new MockHttpError(forbidden('只能签署分配给自己的审批任务', { status: 403 }));
  }
  return { signature: dataUrl, signatureEvidence };
}

export async function resolveMockWorkflowFormSignatures(request: Request, fields: WorkflowFormField[], values: Record<string, unknown>, previous: Record<string, unknown> = {}) {
  try {
    return await mapWorkflowFormSignatures(fields, values, previous, (input, policy) => resolveMockUserSignature(request, input, policy));
  } catch (error) {
    if (error instanceof WorkflowFormSignatureError) throw new MockHttpError(badRequest(error.message, { status: 400 }));
    throw error;
  }
}
