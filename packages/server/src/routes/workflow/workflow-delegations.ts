import { OpenAPIHono } from '@hono/zod-openapi';
import { workflowDelegationContract } from '@arcbase/shared/workflow';
import { validationHook } from '../../lib/openapi-schemas';
import {
  listWorkflowDelegations,
  createWorkflowDelegation,
  updateWorkflowDelegation,
  deleteWorkflowDelegation,
  getWorkflowDelegation,
} from '../../services/workflow/workflow-delegations.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

mountCrud(router, workflowDelegationContract,
  {
    list: listWorkflowDelegations,
    get: getWorkflowDelegation,
    create: createWorkflowDelegation,
    update: updateWorkflowDelegation,
    remove: deleteWorkflowDelegation,
  },
  {
    messages: { create: '已新增', update: '已更新', remove: '已删除' },
  },
);

export default router;
