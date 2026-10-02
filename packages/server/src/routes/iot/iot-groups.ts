/**
 * IoT 设备分组
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { iotDeviceGroupContract } from '@arcbase/shared/iot';
import { setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
import {
  createIotDeviceGroup,
  deleteIotDeviceGroup,
  ensureIotDeviceGroupExists,
  getIotDeviceGroup,
  listAllIotDeviceGroups,
  listIotDeviceGroups,
  mapIotDeviceGroup,
  updateIotDeviceGroup,
} from '../../services/iot/iot-groups.service';
import { mountCrud } from '../_crud';

const iotGroupsRouter = new OpenAPIHono({ defaultHook: validationHook });

const notFound = { 404: { content: jsonContent(ErrorResponse), description: '不存在' } } as const;
const allRoute = defineContractRoute(iotDeviceGroupContract.all, {
  handler: async (c) => c.json(okBody(await listAllIotDeviceGroups()), 200),
});
const createRoute_ = defineContractRoute(iotDeviceGroupContract.create, {
  handler: async (c) => c.json(okBody(await createIotDeviceGroup(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute_ = defineContractRoute(iotDeviceGroupContract.update, {
  responses: notFound,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapIotDeviceGroup(await ensureIotDeviceGroupExists(id)));
    return c.json(okBody(await updateIotDeviceGroup(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute_ = defineContractRoute(iotDeviceGroupContract.remove, {
  responses: notFound,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapIotDeviceGroup(await ensureIotDeviceGroupExists(id)));
    await deleteIotDeviceGroup(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

mountCrud(iotGroupsRouter, iotDeviceGroupContract,
  { list: listIotDeviceGroups, get: getIotDeviceGroup },
  { exclude: ['create', 'update', 'remove'], responses: { detail: notFound } },
  [allRoute, createRoute_, updateRoute_, deleteRoute_],
);

export default iotGroupsRouter;
