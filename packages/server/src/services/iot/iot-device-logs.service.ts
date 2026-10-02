import { iotDeviceContract, iotDeviceLogSchema } from '@arcbase/shared/iot';
import type { QueryOutputOf } from '@arcbase/shared/core';
/**
 * IoT 设备日志通道：设备上报运行日志（追加型，保留策略裁剪）。
 */
import { desc, eq } from 'drizzle-orm';
import type { IotLogIngestInput } from '@arcbase/shared/iot';
import { db } from '../../db';
import { iotDeviceLogs, type IotDeviceLogRow, type IotDeviceRow } from '../../db/schema';
import { parseDateTimeInput } from '../../lib/datetime';
import { listRows } from '../../lib/list-query';
import { buildWhere, dateRangeConditions, keywordCondition } from '../../lib/where-helpers';
import { pickEntity } from '../../lib/entity-map';

export function mapIotDeviceLog(row: IotDeviceLogRow) {
  return pickEntity(iotDeviceLogSchema, row);
}

/** 设备侧批量上报（HTTP ingest 与 WS log 帧共用） */
export async function ingestIotDeviceLogs(device: IotDeviceRow, input: IotLogIngestInput): Promise<number> {
  const rows = input.items.map((item) => ({
    deviceId: device.id,
    level: item.level,
    tag: item.tag ?? null,
    content: item.content,
    reportedAt: (item.reportedAt ? parseDateTimeInput(item.reportedAt) : null) ?? new Date(),
  }));
  if (rows.length > 0) await db.insert(iotDeviceLogs).values(rows);
  return rows.length;
}

export async function listIotDeviceLogs(deviceId: number, q: QueryOutputOf<typeof iotDeviceContract.logs>) {
  const { page, pageSize } = q;
  const where = buildWhere(
    eq(iotDeviceLogs.deviceId, deviceId),
    q.level ? eq(iotDeviceLogs.level, q.level) : undefined,
    keywordCondition(q.keyword, [iotDeviceLogs.content], 'ilike'),
    ...dateRangeConditions(iotDeviceLogs.reportedAt, q.startTime, q.endTime),
  );
  return listRows({
    page,
    pageSize,
    table: iotDeviceLogs,
    where,
    orderBy: [desc(iotDeviceLogs.id)],
    map: mapIotDeviceLog,
  });
}
