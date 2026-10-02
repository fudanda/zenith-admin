import { OpenAPIHono } from '@hono/zod-openapi';
import { aiAgentContract } from '@arcbase/shared/ai';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listMyAgents,
  listBuiltinAgents,
  createAgent,
  updateAgent,
  deleteAgent,
  getAgentDetail,
} from '../../services/ai/ai-agents.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

const builtin = defineContractRoute(aiAgentContract.builtin, {
  handler: async (c) => c.json(okBody(await listBuiltinAgents()), 200),
});

mountCrud(router, aiAgentContract,
  { get: getAgentDetail, create: createAgent, update: updateAgent, remove: deleteAgent, list: listMyAgents },
  {},
  [builtin],
);

export default router;
