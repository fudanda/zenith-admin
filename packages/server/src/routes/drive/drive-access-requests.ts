import { OpenAPIHono } from '@hono/zod-openapi';
import { driveAccessRequestContract } from '@arcbase/shared/drive';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  cancelDriveAccessRequest,
  countPendingDriveAccessRequests,
  createDriveAccessRequest,
  decideDriveAccessRequest,
  getDriveAccessTarget,
  listDriveAccessRequests,
} from '../../services/drive/drive-access-requests.service';
import { mountCrud } from '../_crud';

/**
 * 访问申请：申请人只需网盘查询权限；审批由节点 ACL（manager）决定，授权动作复用 drive:node:grant 审计。
 */
const router = new OpenAPIHono({ defaultHook: validationHook });
const pendingCountRoute = defineContractRoute(driveAccessRequestContract.pendingCount, {
  handler: async (c) => c.json(okBody(await countPendingDriveAccessRequests()), 200),
});

const targetRoute = defineContractRoute(driveAccessRequestContract.target, {
  handler: async (c) => c.json(okBody(await getDriveAccessTarget(c.req.valid('param').id)), 200),
});

const createRoute = defineContractRoute(driveAccessRequestContract.create, {
  handler: async (c) => c.json(okBody(await createDriveAccessRequest(c.req.valid('json')), '申请已提交'), 200),
});

const decideRoute = defineContractRoute(driveAccessRequestContract.decide, {
  handler: async (c) => {
    const result = await decideDriveAccessRequest(c.req.valid('param').id, c.req.valid('json'));
    return c.json(okBody(result, result.status === 'approved' ? '已通过' : '已拒绝'), 200);
  },
});

const cancelRoute = defineContractRoute(driveAccessRequestContract.cancel, {
  handler: async (c) => c.json(okBody(await cancelDriveAccessRequest(c.req.valid('param').id), '已撤回'), 200),
});

mountCrud(router, driveAccessRequestContract,
  { list: listDriveAccessRequests },
  { exclude: ['create'] },
  [pendingCountRoute, targetRoute, createRoute, decideRoute, cancelRoute],
);

export default router;
