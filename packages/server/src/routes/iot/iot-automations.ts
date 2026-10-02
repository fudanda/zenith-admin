/**
 * IoT 场景联动
 *
 * CRUD + 执行记录查询；触发评估在设备接入热路径（见 iot-automations.service）。
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { iotAutomationContract } from '@arcbase/shared/iot';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
import {
  createIotAutomation,
  deleteIotAutomation,
  ensureIotAutomationExists,
  listIotAutomationRuns,
  listIotAutomations,
  mapIotAutomation,
  updateIotAutomation,
} from '../../services/iot/iot-automations.service';
import { mountCrud } from '../_crud';

export const iotAutomationsRouter = new OpenAPIHono({ defaultHook: validationHook });

const notFound = { 404: { content: jsonContent(ErrorResponse), description: '不存在' } } as const;
const listRunsRoute = defineContractRoute(iotAutomationContract.runs, {
  handler: async (c) => c.json(okBody(await listIotAutomationRuns(c.req.valid('query'))), 200),
});

mountCrud(iotAutomationsRouter, iotAutomationContract,
  {
    list: listIotAutomations,
    get: async (id: number) => mapIotAutomation(await ensureIotAutomationExists(id)),
    create: createIotAutomation,
    update: updateIotAutomation,
    remove: deleteIotAutomation,
  },
  {
    responses: { update: notFound, remove: notFound },
  },
  [listRunsRoute],
);
