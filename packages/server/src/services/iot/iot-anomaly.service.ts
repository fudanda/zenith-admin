/**
 * IoT 遥测异常检测（统计基线 3σ 判定）。
 *
 * 基线：近 IOT_ANOMALY_BASELINE_DAYS 天小时聚合（iot_telemetry_hourly）的
 * avg 的均值与标准差，按「产品 × 属性」维度计算，内存缓存 10 分钟。
 * 判定：|value - mean| > IOT_ANOMALY_SIGMA × std → 记一条 kind='anomaly'
 * 设备事件（level=warn，payload 带统计上下文），Redis 去抖避免抖动刷屏。
 *
 * 挂在遥测 ingest 热路径上：基线来自缓存，未开启检测的产品零额外查询；
 * 失败静默不阻断 ingest。异常事件本身可再被事件类告警规则 / 场景联动消费。
 */
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import type { IotMetricValue } from '@arcbase/shared/iot';
import {
  IOT_ANOMALY_BASELINE_DAYS, IOT_ANOMALY_DEBOUNCE_SECONDS, IOT_ANOMALY_MIN_SAMPLES, IOT_ANOMALY_SIGMA,
} from '@arcbase/shared/iot';
import { db } from '../../db';
import {
  iotDeviceEvents, iotDevices, iotProductProperties, iotTelemetryHourly, type IotDeviceRow,
} from '../../db/schema';
import { formatDateTime } from '../../lib/datetime';
import redis from '../../lib/redis';
import logger from '../../lib/logger';
import { TtlCache } from '../../lib/ttl-cache';
import { pushIotRealtime } from './iot-realtime';

const BASELINE_CACHE_TTL_MS = 10 * 60_000;

interface PropertyBaseline {
  mean: number;
  std: number;
  samples: number;
  propertyName: string;
}

/** productId → (identifier → baseline)；空 Map = 该产品无开启检测的属性。单飞防击穿，过期用旧基线后台刷新 */
const baselineCache = new TtlCache<number, Map<string, PropertyBaseline>>(BASELINE_CACHE_TTL_MS);

/** 物模型属性变更（开关/删除）后主动失效基线 */
export function invalidateAnomalyBaselines(productId: number): void {
  baselineCache.delete(productId);
}

function loadBaselines(productId: number): Promise<Map<string, PropertyBaseline>> {
  return baselineCache.get(productId, () => computeBaselines(productId));
}

async function computeBaselines(productId: number): Promise<Map<string, PropertyBaseline>> {
  const now = Date.now();
  const props = await db.select({ identifier: iotProductProperties.identifier, name: iotProductProperties.name })
    .from(iotProductProperties)
    .where(and(
      eq(iotProductProperties.productId, productId),
      eq(iotProductProperties.anomalyEnabled, true),
      eq(iotProductProperties.dataType, 'number'),
    ));
  const baselines = new Map<string, PropertyBaseline>();
  if (props.length > 0) {
    const since = new Date(now - IOT_ANOMALY_BASELINE_DAYS * 86_400_000);
    const identifiers = props.map((p) => p.identifier);
    // 产品维度基线：该产品全部设备的小时均值分布（hourly 表无产品列，经设备表关联）
    const rows = await db.select({
      property: iotTelemetryHourly.property,
      mean: sql<number>`avg(${iotTelemetryHourly.avgValue})`,
      std: sql<number>`coalesce(stddev_samp(${iotTelemetryHourly.avgValue}), 0)`,
      samples: sql<number>`count(*)`,
    }).from(iotTelemetryHourly)
      .innerJoin(iotDevices, eq(iotTelemetryHourly.deviceId, iotDevices.id))
      .where(and(
        eq(iotDevices.productId, productId),
        inArray(iotTelemetryHourly.property, identifiers),
        gte(iotTelemetryHourly.bucket, since),
      ))
      .groupBy(iotTelemetryHourly.property);
    const nameMap = new Map(props.map((p) => [p.identifier, p.name]));
    for (const row of rows) {
      const samples = Number(row.samples);
      const std = Number(row.std);
      // 样本不足或方差为 0（恒定值）不建基线
      if (samples < IOT_ANOMALY_MIN_SAMPLES || std <= 0) continue;
      baselines.set(row.property, {
        mean: Number(row.mean),
        std,
        samples,
        propertyName: nameMap.get(row.property) ?? row.property,
      });
    }
  }
  return baselines;
}

/** 遥测 ingest 逐帧判定（失败静默；无基线时零写放大） */
export async function evaluateIotAnomalies(
  device: IotDeviceRow,
  metrics: Record<string, IotMetricValue>,
): Promise<void> {
  try {
    const baselines = await loadBaselines(device.productId);
    if (baselines.size === 0) return;
    for (const [identifier, value] of Object.entries(metrics)) {
      if (typeof value !== 'number') continue;
      const baseline = baselines.get(identifier);
      if (!baseline) continue;
      const deviation = Math.abs(value - baseline.mean);
      if (deviation <= IOT_ANOMALY_SIGMA * baseline.std) continue;

      // 去抖：同一设备 × 属性在窗口内只记一次
      const debounceKey = `iot:anomaly:${device.id}:${identifier}`;
      const fresh = await redis.set(debounceKey, '1', 'EX', IOT_ANOMALY_DEBOUNCE_SECONDS, 'NX');
      if (fresh === null) continue;

      const sigma = baseline.std > 0 ? deviation / baseline.std : 0;
      const [event] = await db.insert(iotDeviceEvents).values({
        deviceId: device.id,
        kind: 'anomaly',
        identifier,
        name: `${baseline.propertyName}异常`,
        level: 'warn',
        payload: {
          value,
          mean: Number(baseline.mean.toFixed(4)),
          std: Number(baseline.std.toFixed(4)),
          sigma: Number(sigma.toFixed(2)),
          baselineDays: IOT_ANOMALY_BASELINE_DAYS,
          samples: baseline.samples,
        },
        reportedAt: new Date(),
      }).returning();
      pushIotRealtime({
        type: 'iot:device-event',
        payload: {
          deviceId: device.id,
          kind: 'anomaly',
          identifier,
          name: `${baseline.propertyName}异常`,
          level: 'warn',
          reportedAt: formatDateTime(event ? event.reportedAt : new Date()),
        },
      });
      logger.info(`[iot-anomaly] 设备 ${device.sn} 属性 ${identifier} 偏离基线 ${sigma.toFixed(1)}σ（值 ${value}，均值 ${baseline.mean.toFixed(2)}）`);
    }
  } catch (err) {
    logger.warn(`[iot-anomaly] 异常判定失败 deviceId=${device.id}: ${(err as Error).message}`);
  }
}
