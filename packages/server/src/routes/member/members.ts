import { OpenAPIHono } from '@hono/zod-openapi';
import { memberContract } from '@arcbase/shared/member';
import { setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { idempotencyGuard } from '../../middleware/idempotency';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listMembers,
  getMemberDetail,
  getMemberOverview,
  getMemberOptions,
  listMemberLoginLogs,
  createMember,
  updateMember,
  setMemberStatus,
  batchSetMemberStatus,
  batchSetMemberLevel,
  resetMemberPasswordByAdmin,
  deleteMember,
  getMemberBeforeAudit,
  getMembersBeforeAudit,
} from '../../services/member/admin-members.service';
import { addGrowthValue } from '../../services/member/member-levels.service';
import { setMemberTags, batchAddMemberTags } from '../../services/member/member-tags.service';
import { doMakeupCheckin, getMakeupCheckinBeforeAudit } from '../../services/member/member-checkin.service';
import { mountCrud } from '../_crud';

const membersRouter = new OpenAPIHono({ defaultHook: validationHook });

const batchStatusRoute = defineContractRoute(memberContract.batchStatus, {
  handler: async (c) => {
    const { ids, status } = c.req.valid('json');
    const before = await getMembersBeforeAudit(ids);
    if (before.length > 0) setAuditBeforeData(c, before);
    const count = await batchSetMemberStatus(ids, status);
    const after = await getMembersBeforeAudit(ids);
    if (after.length > 0) setAuditAfterData(c, after);
    return c.json(okBody(null, `已更新 ${count} 名会员状态`), 200);
  },
});

const batchLevelRoute = defineContractRoute(memberContract.batchLevel, {
  handler: async (c) => {
    const { ids, levelId } = c.req.valid('json');
    const before = await getMembersBeforeAudit(ids);
    if (before.length > 0) setAuditBeforeData(c, before);
    const count = await batchSetMemberLevel(ids, levelId);
    const after = await getMembersBeforeAudit(ids);
    if (after.length > 0) setAuditAfterData(c, after);
    return c.json(okBody(null, `已调整 ${count} 名会员等级`), 200);
  },
});

const batchTagsRoute = defineContractRoute(memberContract.batchTags, {
  handler: async (c) => {
    const { ids, tagIds } = c.req.valid('json');
    const before = await getMembersBeforeAudit(ids);
    if (before.length > 0) setAuditBeforeData(c, before);
    const count = await batchAddMemberTags(ids, tagIds);
    const after = await getMembersBeforeAudit(ids);
    if (after.length > 0) setAuditAfterData(c, after);
    return c.json(okBody(null, `已为 ${count} 名会员追加标签`), 200);
  },
});

const overviewRoute = defineContractRoute(memberContract.overview, {
  handler: async (c) => c.json(okBody(await getMemberOverview(c.req.valid('param').id)), 200),
});
const optionsRoute = defineContractRoute(memberContract.options, {
  handler: async (c) => c.json(okBody(await getMemberOptions(c.req.valid('query').keyword)), 200),
});

const loginLogsRoute = defineContractRoute(memberContract.loginLogs, {
  handler: async (c) => c.json(okBody(await listMemberLoginLogs(c.req.valid('query'))), 200),
});

const makeupCheckinRoute = defineContractRoute(memberContract.makeupCheckin, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { date, reason } = c.req.valid('json');
    setAuditBeforeData(c, await getMakeupCheckinBeforeAudit(id, date));
    const result = await doMakeupCheckin({ memberId: id, date, mode: 'admin', reason });
    setAuditAfterData(c, { ...(await getMakeupCheckinBeforeAudit(id, date)), makeupReason: reason });
    return c.json(okBody(result, '补签成功'), 200);
  },
});

const adjustGrowthRoute = defineContractRoute(memberContract.adjustGrowth, {
  middleware: [idempotencyGuard({ ttlSeconds: 10 })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { delta, remark } = c.req.valid('json');
    setAuditBeforeData(c, await getMemberBeforeAudit(id));
    await addGrowthValue(id, delta);
    const after = await getMemberDetail(id);
    setAuditAfterData(c, { ...after, adjustRemark: remark ?? null });
    return c.json(okBody(after, '已调整'), 200);
  },
});

const setTagsRoute = defineContractRoute(memberContract.setTags, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMemberBeforeAudit(id));
    await setMemberTags(id, c.req.valid('json').tagIds);
    const after = await getMemberDetail(id);
    setAuditAfterData(c, after);
    return c.json(okBody(after, '已更新'), 200);
  },
});
const setStatusRoute = defineContractRoute(memberContract.setStatus, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { status } = c.req.valid('json');
    setAuditBeforeData(c, await getMemberBeforeAudit(id));
    return c.json(okBody(await setMemberStatus(id, status), '已更新'), 200);
  },
});

const resetPasswordRoute = defineContractRoute(memberContract.resetPassword, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMemberBeforeAudit(id));
    await resetMemberPasswordByAdmin(id, c.req.valid('json').newPassword);
    return c.json(okBody(null, '密码已重置'), 200);
  },
});

mountCrud(membersRouter, memberContract,
  { list: listMembers, get: getMemberDetail, create: createMember, update: updateMember, remove: deleteMember },
  {},
  [
    batchStatusRoute,
    batchLevelRoute,
    batchTagsRoute,
    overviewRoute,
    optionsRoute,
    loginLogsRoute,
    makeupCheckinRoute,
    adjustGrowthRoute,
    setTagsRoute,
    setStatusRoute,
    resetPasswordRoute,
  ],
);

export default membersRouter;
