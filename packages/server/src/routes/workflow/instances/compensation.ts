// ─── 补偿中心 ───
import { workflowInstanceOpsContract } from '@arcbase/shared/workflow';
import { defineContractRoute } from '../../../lib/contract-route';
import { okBody } from '../../../lib/openapi-schemas';
import { resumeInstanceForCompensation } from '../../../services/workflow/workflow-instances.service';
import { listCompensations, resolveCompensation, getCompensationDetail, addCompensationNote, retryCompensationAction } from '../../../services/workflow/workflow-compensations.service';

export const compensationsRoute = defineContractRoute(workflowInstanceOpsContract.compensations, {
  handler: async (c) => c.json(okBody(await listCompensations(c.req.valid('query'))), 200),
});

export const compensationResolveRoute = defineContractRoute(workflowInstanceOpsContract.resolveCompensation, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const b = c.req.valid('json');
    return c.json(okBody(await resolveCompensation(id, b.action, b.resolution), '已处理'), 200);
  },
});

export const compensationDetailRoute = defineContractRoute(workflowInstanceOpsContract.compensationDetail, {
  handler: async (c) => c.json(okBody(await getCompensationDetail(c.req.valid('param').id)), 200),
});

export const compensationNoteRoute = defineContractRoute(workflowInstanceOpsContract.addCompensationNote, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const b = c.req.valid('json');
    return c.json(okBody(await addCompensationNote(id, b.note, b.attachments), '已记录'), 200);
  },
});

export const compensationRetryRoute = defineContractRoute(workflowInstanceOpsContract.retryCompensation, {
  handler: async (c) => c.json(okBody(await retryCompensationAction(c.req.valid('param').id), '已重新入队'), 200),
});

export const compensationResumeRoute = defineContractRoute(workflowInstanceOpsContract.resumeCompensation, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await resumeInstanceForCompensation(id);
    return c.json(okBody(await getCompensationDetail(id), '已恢复推进'), 200);
  },
});
