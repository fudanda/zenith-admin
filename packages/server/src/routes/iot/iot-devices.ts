/**
 * IoT 设备管理
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { iotDeviceContract } from '@arcbase/shared/iot';
import { setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, errBody, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listIotDevices,
  getIotDevice,
  createIotDevice,
  updateIotDevice,
  deleteIotDevices,
  resetIotDeviceSecret,
  clearIotDeviceTelemetry,
  ensureIotDeviceExists,
  mapIotDevice,
} from '../../services/iot/iot-devices.service';
import { listIotTelemetry, listIotCommands, sendIotCommand } from '../../services/iot/iot-telemetry.service';
import { listIotTelemetryAgg } from '../../services/iot/iot-rollup.service';
import { clearIotDesired, getIotDeviceShadow, setIotDesired } from '../../services/iot/iot-shadow.service';
import { listIotDeviceEvents } from '../../services/iot/iot-events.service';
import { listIotDeviceLogs } from '../../services/iot/iot-device-logs.service';
import { getIotDeviceTopology } from '../../services/iot/iot-topology.service';
import { mountCrud } from '../_crud';

const iotDevicesRouter = new OpenAPIHono({ defaultHook: validationHook });

const notFound = { 404: { content: jsonContent(ErrorResponse), description: '不存在' } } as const;
// ─── 批量删除 ────────────────────────────────────────────────────────────────
const batchDeleteRoute = defineContractRoute(iotDeviceContract.removeBatch, {
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    if (!ids?.length) return c.json(errBody('请选择要删除的记录'), 400);
    const deleted = await deleteIotDevices(ids);
    return c.json(okBody(null, `已删除 ${deleted} 台设备`), 200);
  },
});
// ─── 遥测点列 ────────────────────────────────────────────────────────────────
const telemetryRoute = defineContractRoute(iotDeviceContract.telemetry, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await listIotTelemetry(id, c.req.valid('query'))), 200);
  },
});

// ─── 长窗口小时聚合 ──────────────────────────────────────────────────────────
const telemetryAggRoute = defineContractRoute(iotDeviceContract.telemetryAgg, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { property, days } = c.req.valid('query');
    return c.json(okBody(await listIotTelemetryAgg(id, property, days)), 200);
  },
});

// ─── 指令：列表 + 下发 ────────────────────────────────────────────────────────
const listCommandsRoute = defineContractRoute(iotDeviceContract.listCommands, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await listIotCommands(id, c.req.valid('query'))), 200);
  },
});

const sendCommandRoute = defineContractRoute(iotDeviceContract.sendCommand, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const row = await sendIotCommand(id, c.req.valid('json'));
    return c.json(okBody(row, row.status === 'delivered' ? '指令已实时送达设备' : '设备离线，指令将在上线后送达'), 200);
  },
});

// ─── 重置设备密钥 ────────────────────────────────────────────────────────────
const resetSecretRoute = defineContractRoute(iotDeviceContract.resetSecret, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await resetIotDeviceSecret(id), '密钥已重置，请更新设备侧配置'), 200);
  },
});

// ─── 清空遥测 ────────────────────────────────────────────────────────────────
const clearTelemetryRoute = defineContractRoute(iotDeviceContract.clearTelemetry, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const deleted = await clearIotDeviceTelemetry(id);
    return c.json(okBody(null, `已清空 ${deleted} 条遥测数据`), 200);
  },
});

// ─── 影子与事件 ───────────────────────────────────────────────────────────────
const getShadowRoute = defineContractRoute(iotDeviceContract.shadow, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await getIotDeviceShadow(id)), 200);
  },
});

const setDesiredRoute = defineContractRoute(iotDeviceContract.setDesired, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const row = await setIotDesired(id, c.req.valid('json'));
    return c.json(okBody(row, '期望属性已下发，设备确认后自动收敛'), 200);
  },
});

const clearDesiredRoute = defineContractRoute(iotDeviceContract.clearDesired, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await clearIotDesired(id), '期望属性已清空'), 200);
  },
});

const listEventsRoute = defineContractRoute(iotDeviceContract.events, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await ensureIotDeviceExists(id);
    return c.json(okBody(await listIotDeviceEvents(id, c.req.valid('query'))), 200);
  },
});
// ─── 更新 ────────────────────────────────────────────────────────────────────
const updateRoute_ = defineContractRoute(iotDeviceContract.update, {
  responses: notFound,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await ensureIotDeviceExists(id);
    // 审计快照不含接入密钥
    const { secret: _secret, ...safeBefore } = mapIotDevice(before);
    setAuditBeforeData(c, safeBefore);
    return c.json(okBody(await updateIotDevice(id, c.req.valid('json')), '更新成功'), 200);
  },
});

// ─── 删除 ────────────────────────────────────────────────────────────────────
const deleteRoute_ = defineContractRoute(iotDeviceContract.remove, {
  responses: notFound,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await ensureIotDeviceExists(id);
    const { secret: _secret, ...safeBefore } = mapIotDevice(before);
    setAuditBeforeData(c, safeBefore);
    await deleteIotDevices([id]);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

// ─── 拓扑与设备日志 ───────────────────────────────────────────────────────────
const topologyRoute = defineContractRoute(iotDeviceContract.topology, {
  responses: { 404: { content: jsonContent(ErrorResponse), description: '设备不存在' } },
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const device = await ensureIotDeviceExists(id);
    return c.json(okBody(await getIotDeviceTopology(device)), 200);
  },
});

const listLogsRoute = defineContractRoute(iotDeviceContract.logs, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await ensureIotDeviceExists(id);
    return c.json(okBody(await listIotDeviceLogs(id, c.req.valid('query'))), 200);
  },
});

mountCrud(iotDevicesRouter, iotDeviceContract,
  { list: listIotDevices, get: getIotDevice, create: createIotDevice },
  {
    exclude: ['update', 'remove', 'removeBatch'],
    responses: { detail: notFound },
  },
  [
    batchDeleteRoute,
    telemetryAggRoute,
    telemetryRoute,
    listCommandsRoute,
    sendCommandRoute,
    resetSecretRoute,
    clearTelemetryRoute,
    getShadowRoute,
    setDesiredRoute,
    clearDesiredRoute,
    listEventsRoute,
    topologyRoute,
    listLogsRoute,
    updateRoute_,
    deleteRoute_,
  ],
);

export default iotDevicesRouter;
