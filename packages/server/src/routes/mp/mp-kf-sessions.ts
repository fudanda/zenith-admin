import { OpenAPIHono } from '@hono/zod-openapi';
import { mpKfSessionContract } from '@arcbase/shared/mp';
import { setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listMpKfSessions,
  getMpKfSessionDetail,
  getMpKfSessionStats,
  acceptMpKfSession,
  transferMpKfSession,
  closeMpKfSession,
  replyMpKfSession,
  getMpKfRoutingConfig,
  updateMpKfRoutingConfig,
  rateMpKfSession,
  getMpKfSessionReport,
  getMpKfRoutingConfigBeforeAudit,
  getMpKfSessionBeforeAudit,
} from '../../services/mp/mp-kf-session.service';
import { mountCrud } from '../_crud';

const mpKfSessionRouter = new OpenAPIHono({ defaultHook: validationHook });

const statsRoute = defineContractRoute(mpKfSessionContract.stats, {
  handler: async (c) => c.json(okBody(await getMpKfSessionStats(c.req.valid('query').accountId)), 200),
});

const getConfigRoute = defineContractRoute(mpKfSessionContract.config, {
  handler: async (c) => c.json(okBody(await getMpKfRoutingConfig(c.req.valid('query').accountId)), 200),
});

const updateConfigRoute = defineContractRoute(mpKfSessionContract.updateConfig, {
  handler: async (c) => {
    const { accountId } = c.req.valid('query');
    setAuditBeforeData(c, await getMpKfRoutingConfigBeforeAudit(accountId));
    return c.json(okBody(await updateMpKfRoutingConfig(accountId, c.req.valid('json')), '保存成功'), 200);
  },
});

const acceptRoute = defineContractRoute(mpKfSessionContract.accept, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getMpKfSessionBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await acceptMpKfSession(id, c.req.valid('json')), '接入成功'), 200);
  },
});

const transferRoute = defineContractRoute(mpKfSessionContract.transfer, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getMpKfSessionBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await transferMpKfSession(id, c.req.valid('json')), '转接成功'), 200);
  },
});

const closeRoute = defineContractRoute(mpKfSessionContract.close, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getMpKfSessionBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await closeMpKfSession(id, c.req.valid('json')), '已结束'), 200);
  },
});

const replyRoute = defineContractRoute(mpKfSessionContract.reply, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getMpKfSessionBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await replyMpKfSession(id, c.req.valid('json')), '已发送'), 200);
  },
});

const reportRoute = defineContractRoute(mpKfSessionContract.report, {
  handler: async (c) => {
    const q = c.req.valid('query');
    return c.json(okBody(await getMpKfSessionReport(q.accountId, q.days)), 200);
  },
});

const rateRoute = defineContractRoute(mpKfSessionContract.rate, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const b = c.req.valid('json');
    const before = await getMpKfSessionBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await rateMpKfSession(id, b.rating, b.remark), '已记录'), 200);
  },
});

mountCrud(mpKfSessionRouter, mpKfSessionContract,
  { list: listMpKfSessions, get: getMpKfSessionDetail },
  {},
  [
    statsRoute,
    reportRoute,
    getConfigRoute,
    updateConfigRoute,
    acceptRoute,
    transferRoute,
    closeRoute,
    replyRoute,
    rateRoute,
  ],
);

export default mpKfSessionRouter;
