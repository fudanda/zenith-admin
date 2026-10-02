import { OpenAPIHono } from '@hono/zod-openapi';
import { aiAuditContract } from '@arcbase/shared/ai';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { listAuditMessages, getFeedbackContext } from '../../services/ai/ai-conversations.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const list = defineContractRoute(aiAuditContract.messages, {
  handler: async (c) => {
    return c.json(okBody(await listAuditMessages(c.req.valid('query'))), 200);
  },
});

const context = defineContractRoute(aiAuditContract.messageContext, {
  handler: async (c) => {
    const { msgId } = c.req.valid('param');
    return c.json(okBody(await getFeedbackContext(msgId)), 200);
  },
});

router.openapiRoutes([list, context] as const);

export default router;
