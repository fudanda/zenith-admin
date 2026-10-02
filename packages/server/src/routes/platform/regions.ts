import { OpenAPIHono } from '@hono/zod-openapi';
import { regionContract } from '@arcbase/shared/platform';
import { setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listRegionTree,
  listRegionsFlat,
  createRegion,
  updateRegion,
  deleteRegion,
  getRegionBeforeAudit,
  getRegion,
} from '../../services/platform/regions.service';
import { mountCrud } from '../_crud';

const regionsRouter = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineContractRoute(regionContract.tree, {
  handler: async (c) => c.json(okBody(await listRegionTree(c.req.valid('query'))), 200),
});

const flatRoute = defineContractRoute(regionContract.flat, {
  handler: async (c) => c.json(okBody(await listRegionsFlat()), 200),
});
const createRegionRoute = defineContractRoute(regionContract.create, {
  handler: async (c) => c.json(okBody(await createRegion(c.req.valid('json')), '创建成功'), 200),
});

const updateRegionRoute = defineContractRoute(regionContract.update, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getRegionBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await updateRegion(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute = defineContractRoute(regionContract.remove, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getRegionBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await deleteRegion(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

mountCrud(regionsRouter, regionContract,
  { get: getRegion },
  { exclude: ['create', 'update', 'remove'] },
  [listRoute, flatRoute, createRegionRoute, updateRegionRoute, deleteRoute],
);

export default regionsRouter;
