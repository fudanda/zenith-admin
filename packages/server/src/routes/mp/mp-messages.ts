import { OpenAPIHono } from '@hono/zod-openapi';
import { mpMessageContract } from '@arcbase/shared/mp';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { listMessages, listConversations, sendCustomMessage } from '../../services/mp/mp-message.service';
import { mountCrud } from '../_crud';

const mpMessagesRouter = new OpenAPIHono({ defaultHook: validationHook });

const conversationsRoute = defineContractRoute(mpMessageContract.conversations, {
  handler: async (c) => c.json(okBody(await listConversations(c.req.valid('query').accountId)), 200),
});
const sendRoute = defineContractRoute(mpMessageContract.send, {
  handler: async (c) => c.json(okBody(await sendCustomMessage(c.req.valid('json')), '发送成功'), 200),
});

mountCrud(mpMessagesRouter, mpMessageContract,
  { list: listMessages },
  {},
  [conversationsRoute, sendRoute],
);

export default mpMessagesRouter;
