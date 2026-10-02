import type { WorkflowFlowData, WorkflowInstance, WorkflowRejectStrategy } from '@arcbase/shared/workflow';

export interface RejectTargetHint {
  strategy: WorkflowRejectStrategy;
  /** 提示文案 */
  text: string;
  /** 是否为终止流程语义（用于在 UI 中以警示色显示） */
  terminating: boolean;
}

/**
 * 根据当前节点配置与流程实例历史，计算驳回后流程的去向，用于在驳回弹窗中给审批人提示。
 */
export function resolveRejectTargetHint(
  instance: WorkflowInstance | null,
  flowData: WorkflowFlowData | null | undefined,
): RejectTargetHint {
  const fallback: RejectTargetHint = {
    strategy: 'terminate',
    text: '驳回后流程将终止',
    terminating: true,
  };
  if (!instance || !flowData || !instance.currentNodeKey) return fallback;

  const currentNode = flowData.nodes.find(n => n.data.key === instance.currentNodeKey);
  const strategy: WorkflowRejectStrategy = currentNode?.data.rejectStrategy ?? 'terminate';

  if (strategy === 'terminate') return fallback;

  if (strategy === 'returnStart') {
    return {
      strategy,
      text: '驳回后将退回到发起人，发起人可修改后重新提交',
      terminating: false,
    };
  }

  if (strategy === 'returnToNode') {
    const targetKey = currentNode?.data.rejectToNodeKey;
    const target = flowData.nodes.find(n => n.data.key === targetKey);
    if (target) {
      return {
        strategy,
        text: `驳回后将退回到「${target.data.label}」节点重新审批`,
        terminating: false,
      };
    }
    return {
      ...fallback,
      text: '驳回节点配置无效，驳回后流程将终止',
    };
  }

  // returnPrev：尝试从历史任务里推断上一审批节点名称
  const tasks = instance.tasks ?? [];
  const prev = [...tasks]
    .filter(t => t.status === 'approved' && (t.nodeType === 'approve' || t.nodeType === 'handler'))
    .sort((a, b) => {
      const aT = a.actionAt ? new Date(a.actionAt).getTime() : 0;
      const bT = b.actionAt ? new Date(b.actionAt).getTime() : 0;
      if (bT !== aT) return bT - aT;
      return b.id - a.id;
    })[0];
  if (prev) {
    return {
      strategy,
      text: `驳回后将退回到「${prev.nodeName}」节点重新审批`,
      terminating: false,
    };
  }
  return {
    strategy,
    text: '驳回后将退回到上一审批节点重新审批',
    terminating: false,
  };
}
