import { OpenAPIHono } from '@hono/zod-openapi';
import { reportChatbiContract } from '@arcbase/shared/report';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { namedRateLimit } from '../../middleware/rate-limit';
import {
  archiveChatbiSession,
  askChatbi,
  createChatbiSession,
  deleteChatbiSession,
  getChatbiQuotaStats,
  getChatbiSession,
  listChatbiAudit,
  listChatbiSessions,
  saveChatbiMessageAsset,
  updateChatbiSession,
} from '../../services/report/report-chatbi.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineContractRoute(reportChatbiContract.sessions, {
  handler: async (c) => c.json(okBody(await listChatbiSessions(c.req.valid('query'))), 200),
});

const createRouteDef = defineContractRoute(reportChatbiContract.createSession, {
  middleware: [namedRateLimit('report_chatbi_write')],
  handler: async (c) => c.json(okBody(await createChatbiSession(c.req.valid('json')), '创建成功'), 200),
});

const detailRoute = defineContractRoute(reportChatbiContract.sessionDetail, {
  handler: async (c) => c.json(okBody(await getChatbiSession(c.req.valid('param').id)), 200),
});

const updateRouteDef = defineContractRoute(reportChatbiContract.updateSession, {
  middleware: [namedRateLimit('report_chatbi_write')],
  handler: async (c) => c.json(okBody(
    await updateChatbiSession(c.req.valid('param').id, c.req.valid('json')),
    '更新成功',
  ), 200),
});

const archiveRoute = defineContractRoute(reportChatbiContract.archiveSession, {
  middleware: [namedRateLimit('report_chatbi_write')],
  handler: async (c) => c.json(okBody(await archiveChatbiSession(c.req.valid('param').id), '归档成功'), 200),
});

const deleteRouteDef = defineContractRoute(reportChatbiContract.removeSession, {
  middleware: [namedRateLimit('report_chatbi_write')],
  handler: async (c) => {
    await deleteChatbiSession(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const askRoute = defineContractRoute(reportChatbiContract.ask, {
  middleware: [namedRateLimit('chatbi_ask')],
  handler: async (c) => c.json(okBody(await askChatbi(
    c.req.valid('param').id,
    c.req.valid('json'),
    c.req.raw.signal,
  )), 200),
});

const saveRoute = defineContractRoute(reportChatbiContract.saveMessage, {
  middleware: [namedRateLimit('report_chatbi_write')],
  handler: async (c) => c.json(okBody(
    await saveChatbiMessageAsset(c.req.valid('param').id, c.req.valid('json')),
    '保存成功',
  ), 200),
});

const quotaRoute = defineContractRoute(reportChatbiContract.myQuota, {
  handler: async (c) => c.json(okBody(await getChatbiQuotaStats()), 200),
});

const auditRoute = defineContractRoute(reportChatbiContract.audit, {
  handler: async (c) => c.json(okBody(await listChatbiAudit(c.req.valid('query'))), 200),
});

router.openapiRoutes([
  listRoute,
  createRouteDef,
  detailRoute,
  updateRouteDef,
  archiveRoute,
  deleteRouteDef,
  askRoute,
  saveRoute,
  quotaRoute,
  auditRoute,
] as const);

export default router;
