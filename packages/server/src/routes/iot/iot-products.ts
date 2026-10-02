/**
 * IoT 产品管理：产品 CRUD + 物模型（属性/服务/事件）与 TSL 导入导出
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { iotProductContract } from '@arcbase/shared/iot';
import { setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listIotProducts,
  listAllIotProducts,
  getIotProduct,
  createIotProduct,
  updateIotProduct,
  deleteIotProduct,
  ensureIotProductExists,
} from '../../services/iot/iot-devices.service';
import {
  createIotEvent,
  createIotProperty,
  createIotService,
  deleteIotEvent,
  deleteIotProperty,
  deleteIotService,
  ensureIotEventExists,
  ensureIotPropertyExists,
  ensureIotServiceExists,
  getThingModel,
  importIotTsl,
  mapIotEvent,
  mapIotProperty,
  mapIotService,
  updateIotEvent,
  updateIotProperty,
  updateIotService,
} from '../../services/iot/iot-model.service';
import { mountCrud } from '../_crud';

const iotProductsRouter = new OpenAPIHono({ defaultHook: validationHook });

const notFound = { 404: { content: jsonContent(ErrorResponse), description: '不存在' } } as const;
const allRoute = defineContractRoute(iotProductContract.all, {
  handler: async (c) => c.json(okBody(await listAllIotProducts()), 200),
});

const getModelRoute = defineContractRoute(iotProductContract.model, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await ensureIotProductExists(id);
    return c.json(okBody(await getThingModel(id)), 200);
  },
});

const importModelRoute = defineContractRoute(iotProductContract.importModel, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await ensureIotProductExists(id);
    return c.json(okBody(await importIotTsl(id, c.req.valid('json')), '物模型已导入'), 200);
  },
});

const createPropertyRoute = defineContractRoute(iotProductContract.createProperty, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await ensureIotProductExists(id);
    return c.json(okBody(await createIotProperty(id, c.req.valid('json')), '创建成功'), 200);
  },
});

const updatePropertyRoute = defineContractRoute(iotProductContract.updateProperty, {
  handler: async (c) => {
    const { id, propertyId } = c.req.valid('param');
    await ensureIotProductExists(id);
    setAuditBeforeData(c, mapIotProperty(await ensureIotPropertyExists(id, propertyId)));
    return c.json(okBody(await updateIotProperty(id, propertyId, c.req.valid('json')), '更新成功'), 200);
  },
});

const deletePropertyRoute = defineContractRoute(iotProductContract.removeProperty, {
  handler: async (c) => {
    const { id, propertyId } = c.req.valid('param');
    await ensureIotProductExists(id);
    setAuditBeforeData(c, mapIotProperty(await ensureIotPropertyExists(id, propertyId)));
    await deleteIotProperty(id, propertyId);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const createServiceRoute = defineContractRoute(iotProductContract.createService, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await ensureIotProductExists(id);
    return c.json(okBody(await createIotService(id, c.req.valid('json')), '创建成功'), 200);
  },
});

const updateServiceRoute = defineContractRoute(iotProductContract.updateService, {
  handler: async (c) => {
    const { id, serviceId } = c.req.valid('param');
    await ensureIotProductExists(id);
    setAuditBeforeData(c, mapIotService(await ensureIotServiceExists(id, serviceId)));
    return c.json(okBody(await updateIotService(id, serviceId, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteServiceRoute = defineContractRoute(iotProductContract.removeService, {
  handler: async (c) => {
    const { id, serviceId } = c.req.valid('param');
    await ensureIotProductExists(id);
    setAuditBeforeData(c, mapIotService(await ensureIotServiceExists(id, serviceId)));
    await deleteIotService(id, serviceId);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const createEventRoute = defineContractRoute(iotProductContract.createEvent, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await ensureIotProductExists(id);
    return c.json(okBody(await createIotEvent(id, c.req.valid('json')), '创建成功'), 200);
  },
});

const updateEventRoute = defineContractRoute(iotProductContract.updateEvent, {
  handler: async (c) => {
    const { id, eventId } = c.req.valid('param');
    await ensureIotProductExists(id);
    setAuditBeforeData(c, mapIotEvent(await ensureIotEventExists(id, eventId)));
    return c.json(okBody(await updateIotEvent(id, eventId, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteEventRoute = defineContractRoute(iotProductContract.removeEvent, {
  handler: async (c) => {
    const { id, eventId } = c.req.valid('param');
    await ensureIotProductExists(id);
    setAuditBeforeData(c, mapIotEvent(await ensureIotEventExists(id, eventId)));
    await deleteIotEvent(id, eventId);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

mountCrud(iotProductsRouter, iotProductContract,
  {
    list: listIotProducts,
    get: getIotProduct,
    create: createIotProduct,
    update: updateIotProduct,
    remove: deleteIotProduct,
  },
  {
    responses: { detail: notFound, update: notFound, remove: notFound },
  },
  [
    allRoute,
    getModelRoute,
    importModelRoute,
    createPropertyRoute,
    updatePropertyRoute,
    deletePropertyRoute,
    createServiceRoute,
    updateServiceRoute,
    deleteServiceRoute,
    createEventRoute,
    updateEventRoute,
    deleteEventRoute,
  ],
);

export default iotProductsRouter;
