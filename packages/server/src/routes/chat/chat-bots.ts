import { OpenAPIHono } from '@hono/zod-openapi';
import { chatBotContract } from '@arcbase/shared/chat';
import { setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { validationHook, okBody } from '../../lib/openapi-schemas';
import {
  listChatWebhooks,
  createChatWebhook,
  updateChatWebhook,
  deleteChatWebhook,
  regenerateChatWebhookToken,
  getChatWebhookBeforeAudit,
  sanitizeChatWebhookForAudit,
} from '../../services/chat/chat-webhooks.service';
import { mountCrud } from '../_crud';

const chatBotsRoute = new OpenAPIHono({ defaultHook: validationHook });

const create = defineContractRoute(chatBotContract.create, {
  handler: async (c) => {
    const row = await createChatWebhook(c.req.valid('json'));
    setAuditAfterData(c, sanitizeChatWebhookForAudit(row));
    return c.json(okBody(row, '创建成功'), 200);
  },
});

const update = defineContractRoute(chatBotContract.update, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getChatWebhookBeforeAudit(id));
    const row = await updateChatWebhook(id, c.req.valid('json'));
    setAuditAfterData(c, sanitizeChatWebhookForAudit(row));
    return c.json(okBody(row, '更新成功'), 200);
  },
});

const regenerate = defineContractRoute(chatBotContract.regenerateToken, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getChatWebhookBeforeAudit(id));
    const row = await regenerateChatWebhookToken(id);
    setAuditAfterData(c, sanitizeChatWebhookForAudit(row));
    return c.json(okBody(row, '令牌已重置'), 200);
  },
});

mountCrud(chatBotsRoute, chatBotContract,
  { list: listChatWebhooks, get: getChatWebhookBeforeAudit, remove: deleteChatWebhook },
  { exclude: ['create', 'update'] },
  [create, update, regenerate],
);

export default chatBotsRoute;
