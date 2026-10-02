/**
 * 聊天入站 Webhook（公开端点，无需登录，由外部系统以令牌调用）。
 * 令牌在路由处理内校验；命中后以 webhook 身份向其目标会话投递一条消息。
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { chatWebhookPublicContract } from '@arcbase/shared/chat';
import { defineContractRoute } from '../../lib/contract-route';
import { validationHook, okBody } from '../../lib/openapi-schemas';
import { ingestChatWebhook } from '../../services/chat/chat-webhooks.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const ingestRoute = defineContractRoute(chatWebhookPublicContract.ingest, {
  middleware: [],
  handler: async (c) => {
    const { token } = c.req.valid('param');
    await ingestChatWebhook(token, c.req.valid('json'));
    return c.json(okBody(null, '推送成功'), 200);
  },
});

router.openapiRoutes([ingestRoute] as const);

export default router;
