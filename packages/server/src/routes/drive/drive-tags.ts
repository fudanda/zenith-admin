import { OpenAPIHono } from '@hono/zod-openapi';
import { driveTagContract } from '@arcbase/shared/drive';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { createDriveTag, deleteDriveTag, listDriveTags, mergeDriveTags, updateDriveTag } from '../../services/drive/drive-extras.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineContractRoute(driveTagContract.list, {
  handler: async (c) => c.json(okBody(await listDriveTags(c.req.valid('query').spaceId)), 200),
});
const updateRoute = defineContractRoute(driveTagContract.update, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await updateDriveTag(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute = defineContractRoute(driveTagContract.remove, {
  handler: async (c) => {
    await deleteDriveTag(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const mergeRoute = defineContractRoute(driveTagContract.merge, {
  handler: async (c) => {
    await mergeDriveTags(c.req.valid('param').id, c.req.valid('json').targetId);
    return c.json(okBody(null, '标签已合并'), 200);
  },
});

mountCrud(router, driveTagContract,
  { create: createDriveTag },
  { exclude: ['list', 'update', 'remove'] },
  [listRoute, updateRoute, deleteRoute, mergeRoute],
);

export default router;
