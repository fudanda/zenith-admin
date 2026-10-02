import { OpenAPIHono } from '@hono/zod-openapi';
import { driveSpaceContract } from '@arcbase/shared/drive';
import { setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
import { archiveDriveSpace, createQuotaRequest, listSpaceQuotaRequests, unarchiveDriveSpace } from '../../services/drive/drive-governance.service';
import {
  createTeamSpace,
  deleteDriveSpace,
  ensureDriveSpaceExists,
  getDriveSpace,
  getSpaceMembersBeforeAudit,
  listDriveSpaces,
  listMySpaces,
  listSpaceMembers,
  saveSpaceMembers,
  transferDriveSpace,
  updateDriveSpace,
} from '../../services/drive/drive-spaces.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

const mySpacesRoute = defineContractRoute(driveSpaceContract.my, {
  handler: async (c) => c.json(okBody(await listMySpaces()), 200),
});
const createRoute = defineContractRoute(driveSpaceContract.create, {
  handler: async (c) => c.json(okBody(await createTeamSpace(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute = defineContractRoute(driveSpaceContract.update, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await ensureDriveSpaceExists(id));
    return c.json(okBody(await updateDriveSpace(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute = defineContractRoute(driveSpaceContract.remove, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await ensureDriveSpaceExists(id));
    await deleteDriveSpace(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const membersRoute = defineContractRoute(driveSpaceContract.members, {
  handler: async (c) => c.json(okBody(await listSpaceMembers(c.req.valid('param').id)), 200),
});

const saveMembersRoute = defineContractRoute(driveSpaceContract.saveMembers, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getSpaceMembersBeforeAudit(id));
    await saveSpaceMembers(id, c.req.valid('json'));
    setAuditAfterData(c, await getSpaceMembersBeforeAudit(id));
    return c.json(okBody(null, '保存成功'), 200);
  },
});

const transferRoute = defineContractRoute(driveSpaceContract.transfer, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await ensureDriveSpaceExists(id));
    return c.json(okBody(await transferDriveSpace(id, c.req.valid('json').ownerId), '转让成功'), 200);
  },
});

const archiveRoute = defineContractRoute(driveSpaceContract.archive, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await ensureDriveSpaceExists(id));
    return c.json(okBody(await archiveDriveSpace(id), '空间已归档（只读）'), 200);
  },
});

const unarchiveRoute = defineContractRoute(driveSpaceContract.unarchive, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await ensureDriveSpaceExists(id));
    return c.json(okBody(await unarchiveDriveSpace(id), '已恢复归档'), 200);
  },
});

const requestQuotaRoute = defineContractRoute(driveSpaceContract.requestQuota, {
  handler: async (c) => c.json(okBody(await createQuotaRequest(c.req.valid('param').id, c.req.valid('json')), '扩容申请已提交，等待网盘管理员审批'), 200),
});

const quotaRequestsRoute = defineContractRoute(driveSpaceContract.quotaRequests, {
  handler: async (c) => c.json(okBody(await listSpaceQuotaRequests(c.req.valid('param').id)), 200),
});

mountCrud(router, driveSpaceContract,
  { list: listDriveSpaces, get: getDriveSpace },
  {
    exclude: ['create', 'update', 'remove'],
    responses: { detail: { 404: { content: jsonContent(ErrorResponse), description: '不存在' } } },
  },
  [
    mySpacesRoute,
    createRoute,
    updateRoute,
    deleteRoute,
    membersRoute,
    saveMembersRoute,
    transferRoute,
    archiveRoute,
    unarchiveRoute,
    requestQuotaRoute,
    quotaRequestsRoute,
  ],
);

export default router;
