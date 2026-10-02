import { OpenAPIHono } from '@hono/zod-openapi';
import { workflowTriggerExecutionContract } from '@arcbase/shared/workflow';
import { validationHook } from '../../lib/openapi-schemas';
import { listTriggerExecutions, getTriggerExecution } from '../../services/workflow/workflow-trigger-executions.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

mountCrud(router, workflowTriggerExecutionContract,
  { list: listTriggerExecutions, get: getTriggerExecution },
);

export default router;
