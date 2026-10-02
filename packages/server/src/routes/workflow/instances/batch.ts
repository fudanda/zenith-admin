// ─── 批量操作（含审计快照聚合）───
import { workflowInstanceContract, workflowTaskContract } from '@arcbase/shared/workflow';
import { idempotencyGuard } from '../../../middleware/idempotency';
import { defineContractRoute } from '../../../lib/contract-route';
import { getWorkflowInstanceBeforeAudit, getWorkflowTaskBeforeAudit, batchApproveTasks, batchRejectTasks, batchWithdrawInstances, batchUrgeInstances } from '../../../services/workflow/workflow-instances.service';
import { runBatchWithAudit } from './_batch-audit';

export { compactAuditData } from './_batch-audit';

export const batchApproveRoute = defineContractRoute(workflowTaskContract.batchApprove, {
  middleware: [idempotencyGuard({ ttlSeconds: 10 })],
  handler: async (c) => {
    const { taskIds, comment, signature } = c.req.valid('json');
    return c.json(await runBatchWithAudit(c, taskIds, () => batchApproveTasks(taskIds, comment, signature), getWorkflowTaskBeforeAudit), 200);
  },
});

export const batchRejectRoute = defineContractRoute(workflowTaskContract.batchReject, {
  middleware: [idempotencyGuard({ ttlSeconds: 10 })],
  handler: async (c) => {
    const { taskIds, comment } = c.req.valid('json');
    return c.json(await runBatchWithAudit(c, taskIds, () => batchRejectTasks(taskIds, comment), getWorkflowTaskBeforeAudit), 200);
  },
});

export const batchWithdrawRoute = defineContractRoute(workflowInstanceContract.batchWithdraw, {
  handler: async (c) => {
    const { instanceIds, comment } = c.req.valid('json');
    return c.json(await runBatchWithAudit(c, instanceIds, () => batchWithdrawInstances(instanceIds, comment), getWorkflowInstanceBeforeAudit), 200);
  },
});

export const batchUrgeRoute = defineContractRoute(workflowInstanceContract.batchUrge, {
  handler: async (c) => {
    const { instanceIds, message } = c.req.valid('json');
    return c.json(await runBatchWithAudit(c, instanceIds, () => batchUrgeInstances(instanceIds, message)), 200);
  },
});
