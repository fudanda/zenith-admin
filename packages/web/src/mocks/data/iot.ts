import {
  SEED_IOT_ALARM_RULES, SEED_IOT_ALARMS, SEED_IOT_AUTOMATION_RUNS, SEED_IOT_AUTOMATIONS,
  SEED_IOT_DEVICE_EVENTS, SEED_IOT_DEVICE_GROUPS, SEED_IOT_DEVICE_LOGS,
  SEED_IOT_DEVICES, SEED_IOT_FIRMWARES, SEED_IOT_FORWARD_LOGS, SEED_IOT_FORWARD_RULES,
  SEED_IOT_MAINTENANCE_WINDOWS, SEED_IOT_OTA_TASK_DEVICES, SEED_IOT_OTA_TASKS,
  SEED_IOT_PRODUCT_EVENTS, SEED_IOT_PRODUCT_PROPERTIES,
  SEED_IOT_PRODUCT_SERVICES, SEED_IOT_PRODUCTS,
  SEED_IOT_SCHEDULE_RUNS, SEED_IOT_SCHEDULES, SEED_IOT_WHITELIST,
} from '@arcbase/shared/seed';
import type {
  IotAlarm, IotAlarmRule, IotAutomation, IotAutomationRun, IotCommand, IotDevice, IotDeviceEvent, IotDeviceGroup,
  IotDeviceLog, IotDeviceShadow, IotFirmware, IotForwardLog, IotForwardRule, IotMaintenanceWindow,
  IotOtaTask, IotOtaTaskDevice,
  IotProduct, IotProductEvent,
  IotProductProperty, IotProductService, IotSchedule, IotScheduleRun,
  IotTelemetryAggPoint, IotTelemetryPoint, IotWhitelistEntry,
} from '@arcbase/shared/iot';
import { mockDateTime } from '@/mocks/utils/date';
import { nextIdFrom } from '@/mocks/utils/handlers';

export const mockIotProducts: IotProduct[] = SEED_IOT_PRODUCTS.map((p) => ({ ...p }));

export const mockIotProperties: IotProductProperty[] = SEED_IOT_PRODUCT_PROPERTIES.map((p) => ({ ...p }));

export const mockIotServices: IotProductService[] = SEED_IOT_PRODUCT_SERVICES.map((s) => ({ ...s }));

export const mockIotEvents: IotProductEvent[] = SEED_IOT_PRODUCT_EVENTS.map((e) => ({ ...e }));

export const mockIotGroups: IotDeviceGroup[] = SEED_IOT_DEVICE_GROUPS.map((g) => ({ ...g, deviceIds: [...g.deviceIds] }));

export const mockIotDevices: IotDevice[] = SEED_IOT_DEVICES.map((d, i) => ({
  ...d,
  // Demo 模式下 1 号设备呈现在线态
  online: i === 0,
  lastSeenAt: i === 0 ? mockDateTime() : d.lastSeenAt,
}));

export const mockIotShadows: Map<number, IotDeviceShadow> = new Map(SEED_IOT_DEVICES.map((d, i) => [d.id, {
  deviceId: d.id,
  reported: { ...(d.reported ?? {}) },
  reportedAt: d.lastSeenAt,
  desired: { ...(d.desired ?? {}) },
  desiredVersion: 0,
  desiredAt: null,
  online: i === 0,
  updatedAt: mockDateTime(),
}]));

export const mockIotAlarmRules: IotAlarmRule[] = SEED_IOT_ALARM_RULES.map((r) => ({ ...r, notifyUserIds: [...r.notifyUserIds] }));

export const mockIotAlarms: IotAlarm[] = SEED_IOT_ALARMS.map((a) => ({ ...a }));

export const mockIotDeviceEvents: IotDeviceEvent[] = SEED_IOT_DEVICE_EVENTS.map((e) => ({ ...e }));

/** 近 24h 半小时一点的温湿度演示曲线（仅 1 号设备） */
export function buildMockTelemetry(deviceId: number, days: number): IotTelemetryPoint[] {
  if (deviceId !== 1) return [];
  const stepMinutes = days <= 1 ? 30 : days <= 7 ? 240 : 720;
  const count = Math.min(Math.floor((days * 24 * 60) / stepMinutes), 500);
  const now = Date.now();
  return Array.from({ length: count }, (_, i) => {
    const at = new Date(now - (count - 1 - i) * stepMinutes * 60 * 1000);
    const hour = at.getHours() + at.getMinutes() / 60;
    const phase = Math.sin(((hour - 14) / 24) * Math.PI * 2);
    const pad = (n: number) => String(n).padStart(2, '0');
    return {
      metrics: {
        temperature: Math.round((24 + phase * 3) * 10) / 10,
        humidity: Math.round(50 - phase * 8),
      },
      reportedAt: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}:00`,
    };
  });
}

export const mockIotCommands: IotCommand[] = [
  {
    id: 1, deviceId: 1, service: 'calibrate', params: { offset: 0.5 },
    status: 'acked', expireAt: mockDateTime(), sentAt: mockDateTime(), ackedAt: mockDateTime(),
    response: { applied: true }, errorMsg: null, createdBy: 1, createdAt: mockDateTime(),
  },
  {
    id: 2, deviceId: 1, service: 'reboot', params: null,
    status: 'delivered', expireAt: mockDateTime(), sentAt: mockDateTime(), ackedAt: null,
    response: null, errorMsg: null, createdBy: 1, createdAt: mockDateTime(),
  },
];

let nextProductId = nextIdFrom(mockIotProducts);
export function getNextIotProductId(): number {
  return nextProductId++;
}

let nextDeviceId = nextIdFrom(mockIotDevices);
export function getNextIotDeviceId(): number {
  return nextDeviceId++;
}

let nextCommandId = nextIdFrom(mockIotCommands);
export function getNextIotCommandId(): number {
  return nextCommandId++;
}

let nextModelItemId = Math.max(nextIdFrom(mockIotProperties), nextIdFrom(mockIotServices), nextIdFrom(mockIotEvents));
export function getNextIotModelItemId(): number {
  return nextModelItemId++;
}

let nextGroupId = nextIdFrom(mockIotGroups);
export function getNextIotGroupId(): number {
  return nextGroupId++;
}

let nextAlarmRuleId = nextIdFrom(mockIotAlarmRules);
export function getNextIotAlarmRuleId(): number {
  return nextAlarmRuleId++;
}

let nextDeviceEventId = nextIdFrom(mockIotDeviceEvents);
export function getNextIotDeviceEventId(): number {
  return nextDeviceEventId++;
}

/** 设备行上派生分组冗余字段（列表展示） */
export function withGroupInfo(device: IotDevice): IotDevice {
  const groups = mockIotGroups.filter((g) => g.deviceIds.includes(device.id));
  const shadow = mockIotShadows.get(device.id);
  return {
    ...device,
    groupIds: groups.map((g) => g.id),
    groupNames: groups.map((g) => g.name),
    reported: shadow?.reported ?? null,
    desired: shadow?.desired ?? null,
  };
}

// ─── 三期：固件 / OTA / 聚合 ──────────────────────────────────────────────────
export const mockIotFirmwares: IotFirmware[] = SEED_IOT_FIRMWARES.map((f) => ({ ...f }));

export const mockIotOtaTasks: IotOtaTask[] = SEED_IOT_OTA_TASKS.map((t) => ({ ...t }));

export const mockIotOtaTaskDevices: IotOtaTaskDevice[] = SEED_IOT_OTA_TASK_DEVICES.map((d) => ({ ...d }));

let nextFirmwareId = nextIdFrom(mockIotFirmwares);
export function getNextIotFirmwareId(): number {
  return nextFirmwareId++;
}

let nextOtaTaskId = nextIdFrom(mockIotOtaTasks);
export function getNextIotOtaTaskId(): number {
  return nextOtaTaskId++;
}

let nextOtaTaskDeviceId = nextIdFrom(mockIotOtaTaskDevices);
export function getNextIotOtaTaskDeviceId(): number {
  return nextOtaTaskDeviceId++;
}

// ─── 四期：场景联动 ───────────────────────────────────────────────────────────
export const mockIotAutomations: IotAutomation[] = SEED_IOT_AUTOMATIONS.map((a) => ({
  ...a,
  actions: a.actions.map((x) => ({ ...x })),
}));

export const mockIotAutomationRuns: IotAutomationRun[] = SEED_IOT_AUTOMATION_RUNS.map((r) => ({ ...r }));

let nextAutomationId = nextIdFrom(mockIotAutomations);
export function getNextIotAutomationId(): number {
  return nextAutomationId++;
}

// ─── 五期：数据流转 / 设备日志 ────────────────────────────────────────────────
export const mockIotForwardRules: IotForwardRule[] = SEED_IOT_FORWARD_RULES.map((r) => ({ ...r }));

export const mockIotForwardLogs: IotForwardLog[] = SEED_IOT_FORWARD_LOGS.map((l) => ({ ...l }));

let nextForwardRuleId = nextIdFrom(mockIotForwardRules);
export function getNextIotForwardRuleId(): number {
  return nextForwardRuleId++;
}

export const mockIotDeviceLogs: IotDeviceLog[] = SEED_IOT_DEVICE_LOGS.map((l) => ({ ...l }));

// ─── 六期：计划任务 / 维护窗口 / 动态注册 ────────────────────────────────────
export const mockIotSchedules: IotSchedule[] = SEED_IOT_SCHEDULES.map((s) => ({ ...s }));

export const mockIotScheduleRuns: IotScheduleRun[] = SEED_IOT_SCHEDULE_RUNS.map((r) => ({ ...r }));

export const mockIotMaintenanceWindows: IotMaintenanceWindow[] = SEED_IOT_MAINTENANCE_WINDOWS.map((w) => ({ ...w }));

export const mockIotWhitelist: IotWhitelistEntry[] = SEED_IOT_WHITELIST.map((e) => ({ ...e }));

let nextScheduleId = nextIdFrom(mockIotSchedules);
export function getNextIotScheduleId(): number {
  return nextScheduleId++;
}

let nextMaintenanceWindowId = nextIdFrom(mockIotMaintenanceWindows);
export function getNextIotMaintenanceWindowId(): number {
  return nextMaintenanceWindowId++;
}

let nextWhitelistId = nextIdFrom(mockIotWhitelist);
export function getNextIotWhitelistId(): number {
  return nextWhitelistId++;
}

/** 近 N 天的小时聚合演示曲线（仅 1 号设备的数值属性） */
export function buildMockTelemetryAgg(deviceId: number, property: string, days: number): IotTelemetryAggPoint[] {
  if (deviceId !== 1 || (property !== 'temperature' && property !== 'humidity')) return [];
  const hours = Math.min(days, 90) * 24;
  const now = Date.now();
  const pad = (n: number) => String(n).padStart(2, '0');
  return Array.from({ length: hours }, (_, i) => {
    const at = new Date(now - (hours - 1 - i) * 3600_000);
    const hour = at.getHours();
    const phase = Math.sin(((hour - 14) / 24) * Math.PI * 2);
    const base = property === 'temperature' ? 24 + phase * 3 : 50 - phase * 8;
    const spread = property === 'temperature' ? 1.2 : 4;
    return {
      bucket: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(hour)}:00:00`,
      minValue: Math.round((base - spread) * 10) / 10,
      maxValue: Math.round((base + spread) * 10) / 10,
      avgValue: Math.round(base * 10) / 10,
      count: 120,
    };
  });
}
