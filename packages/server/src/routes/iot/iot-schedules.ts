/**
 * IoT 设备计划任务
 *
 * CRUD + 执行记录；到期调度由系统任务 iot-schedule-dispatch 每分钟执行。
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { iotScheduleContract } from '@arcbase/shared/iot';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
import {
  createIotSchedule,
  deleteIotSchedule,
  ensureIotScheduleExists,
  listIotScheduleRuns,
  listIotSchedules,
  mapIotSchedule,
  updateIotSchedule,
} from '../../services/iot/iot-schedules.service';
import { mountCrud } from '../_crud';

export const iotSchedulesRouter = new OpenAPIHono({ defaultHook: validationHook });

const notFound = { 404: { content: jsonContent(ErrorResponse), description: '不存在' } } as const;
const listRunsRoute = defineContractRoute(iotScheduleContract.runs, {
  handler: async (c) => c.json(okBody(await listIotScheduleRuns(c.req.valid('query'))), 200),
});

mountCrud(iotSchedulesRouter, iotScheduleContract,
  {
    list: listIotSchedules,
    get: async (id: number) => mapIotSchedule(await ensureIotScheduleExists(id)),
    create: createIotSchedule,
    update: updateIotSchedule,
    remove: deleteIotSchedule,
  },
  {
    responses: { update: notFound, remove: notFound },
  },
  [listRunsRoute],
);
