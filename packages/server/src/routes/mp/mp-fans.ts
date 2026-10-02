import { OpenAPIHono } from '@hono/zod-openapi';
import { mpFanContract } from '@arcbase/shared/mp';
import { setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listMpFans,
  updateMpFan,
  getMpFanBeforeAudit,
  syncMpFans,
  blacklistMpFans,
  unblacklistMpFans,
  syncMpBlacklist,
  getMpFansBlacklistAudit,
  getMpBlacklistStateAudit,
} from '../../services/mp/mp-fan.service';
import { createMemberForFan, bindFanToMember, unbindFanMember } from '../../services/mp/mp-member.service';
import { mountCrud } from '../_crud';

const mpFansRouter = new OpenAPIHono({ defaultHook: validationHook });
const syncRoute = defineContractRoute(mpFanContract.sync, {
  handler: async (c) => c.json(okBody(await syncMpFans(c.req.valid('json').accountId), '同步完成'), 200),
});
const createMemberRoute = defineContractRoute(mpFanContract.createMember, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMpFanBeforeAudit(id));
    return c.json(okBody(await createMemberForFan(id), '会员已创建并绑定'), 200);
  },
});

const bindMemberRoute = defineContractRoute(mpFanContract.bindMember, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMpFanBeforeAudit(id));
    return c.json(okBody(await bindFanToMember(id, c.req.valid('json').memberId), '绑定成功'), 200);
  },
});

const unbindMemberRoute = defineContractRoute(mpFanContract.unbindMember, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMpFanBeforeAudit(id));
    return c.json(okBody(await unbindFanMember(id), '已解绑'), 200);
  },
});

const blacklistRoute = defineContractRoute(mpFanContract.blacklist, {
  handler: async (c) => {
    const b = c.req.valid('json');
    setAuditBeforeData(c, await getMpFansBlacklistAudit(b.accountId, b.openids));
    const result = await blacklistMpFans(b.accountId, b.openids);
    setAuditAfterData(c, await getMpFansBlacklistAudit(b.accountId, b.openids));
    return c.json(okBody(result, '已拉黑'), 200);
  },
});

const unblacklistRoute = defineContractRoute(mpFanContract.unblacklist, {
  handler: async (c) => {
    const b = c.req.valid('json');
    setAuditBeforeData(c, await getMpFansBlacklistAudit(b.accountId, b.openids));
    const result = await unblacklistMpFans(b.accountId, b.openids);
    setAuditAfterData(c, await getMpFansBlacklistAudit(b.accountId, b.openids));
    return c.json(okBody(result, '已移出'), 200);
  },
});

const syncBlacklistRoute = defineContractRoute(mpFanContract.syncBlacklist, {
  handler: async (c) => {
    const { accountId } = c.req.valid('json');
    setAuditBeforeData(c, await getMpBlacklistStateAudit(accountId));
    const r = await syncMpBlacklist(accountId);
    setAuditAfterData(c, await getMpBlacklistStateAudit(accountId));
    return c.json(okBody({ success: r.success, synced: r.total, total: r.total }, '同步完成'), 200);
  },
});

mountCrud(mpFansRouter, mpFanContract,
  { list: listMpFans, get: getMpFanBeforeAudit, update: updateMpFan },
  {},
  [
    syncRoute,
    blacklistRoute,
    unblacklistRoute,
    syncBlacklistRoute,
    createMemberRoute,
    bindMemberRoute,
    unbindMemberRoute,
  ],
);

export default mpFansRouter;
