/**
 * IoT 遥测微批写入缓冲。
 *
 * 单帧一事务的写法在 ~70 帧/s 就把进程 CPU 花在逐条 socket 写、逐条 upsert 与查询构造上
 * （Windows / 容器网络下单次往返 3~5ms，且每条语句都是一次 WAL fsync）。这里把
 * ≤ FLUSH_INTERVAL_MS 内到达的帧攒成一批：
 * - 明细：多行 INSERT（每 INSERT_CHUNK_ROWS 行一条语句；命中缺失分区则补建后重试）
 * - 影子：每设备合并成一份 patch，一条多行 upsert（RETURNING 直供实时推送）
 * - 今日计数：一次 INCRBY
 *
 * 调用方 await enqueueIotTelemetry() 得到的 Promise 在本批明细落库后才 resolve，
 * 设备回执仍等价「已持久化」，只多出 ≤ FLUSH_INTERVAL_MS 的排队延迟；明细写入失败则整批 reject
 * （HTTP 500 / WS 帧静默丢弃），影子失败只记日志（明细已落库，下一帧会覆盖）。
 * 待写行数达到 MAX_PENDING_ROWS 立即刷；同一时刻只有一批在途，后到的帧攒成下一批，形成自然背压。
 * 停机前 flushIotIngestBuffer() 排空。
 */
import type { IotMetricValue } from '@arcbase/shared/iot';
import { db } from '../../db';
import { iotTelemetry, type IotDeviceRow } from '../../db/schema';
import logger from '../../lib/logger';
import { ensureIotTelemetryPartitionsFor, isMissingIotTelemetryPartitionError } from './iot-partitions.service';
import { mergeIotReportedBatch, type IotReportedMergeResult, type IotReportedPatch } from './iot-shadow.service';
import { bumpIotTelemetryCounter } from './iot-telemetry-counter';

export const FLUSH_INTERVAL_MS = 100;
export const MAX_PENDING_ROWS = 1_000;
const INSERT_CHUNK_ROWS = 500;

export type IotTelemetryRow = typeof iotTelemetry.$inferInsert;

export interface IotTelemetryFrame {
  device: IotDeviceRow;
  rows: IotTelemetryRow[];
  /** 本帧按上报顺序合并出的属性快照 */
  merged: Record<string, IotMetricValue>;
  /** 本帧最新点的 reportedAt */
  latestAt: Date;
}

interface PendingFrame extends IotTelemetryFrame {
  resolve: (result: IotReportedMergeResult | null) => void;
  reject: (err: unknown) => void;
}

let pending: PendingFrame[] = [];
let pendingRows = 0;
let timer: NodeJS.Timeout | null = null;
let inFlight: Promise<void> | null = null;

/** 明细落库：命中缺失分区（乱序回填 / 预建任务漏跑）时按批次内日期补建后重试一次 */
export async function insertIotTelemetryRows(rows: IotTelemetryRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += INSERT_CHUNK_ROWS) {
    const chunk = rows.slice(i, i + INSERT_CHUNK_ROWS);
    try {
      await db.insert(iotTelemetry).values(chunk);
    } catch (err) {
      if (!isMissingIotTelemetryPartitionError(err)) throw err;
      await ensureIotTelemetryPartitionsFor(chunk.map((r) => r.reportedAt ?? new Date()), { recheck: true });
      await db.insert(iotTelemetry).values(chunk);
    }
  }
}

/** 同设备多帧按到达顺序合并成一份影子 patch（ON CONFLICT 不允许同语句内二次命中同一行） */
function coalescePatches(frames: PendingFrame[]): IotReportedPatch[] {
  const byDevice = new Map<number, IotReportedPatch>();
  for (const frame of frames) {
    const current = byDevice.get(frame.device.id);
    if (!current) {
      byDevice.set(frame.device.id, { deviceId: frame.device.id, metrics: { ...frame.merged }, reportedAt: frame.latestAt });
    } else {
      Object.assign(current.metrics, frame.merged);
      if (frame.latestAt > current.reportedAt) current.reportedAt = frame.latestAt;
    }
  }
  return [...byDevice.values()];
}

async function flushBatch(frames: PendingFrame[]): Promise<void> {
  const rows: IotTelemetryRow[] = [];
  for (const frame of frames) rows.push(...frame.rows);
  try {
    await insertIotTelemetryRows(rows);
  } catch (err) {
    logger.error(`[iot-buffer] 遥测批量落库失败（${frames.length} 帧 / ${rows.length} 行）: ${(err as Error).message}`);
    for (const frame of frames) frame.reject(err);
    return;
  }
  bumpIotTelemetryCounter(rows.length);

  let results = new Map<number, IotReportedMergeResult>();
  try {
    results = await mergeIotReportedBatch(coalescePatches(frames));
  } catch (err) {
    logger.warn(`[iot-buffer] 影子批量合并失败（${frames.length} 帧）: ${(err as Error).message}`);
  }
  for (const frame of frames) frame.resolve(results.get(frame.device.id) ?? null);
}

function scheduleFlush(): void {
  if (timer || inFlight) return;
  timer = setTimeout(() => {
    timer = null;
    void flushNow();
  }, FLUSH_INTERVAL_MS);
}

function flushNow(): Promise<void> {
  if (inFlight) return inFlight;
  if (pending.length === 0) return Promise.resolve();
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const frames = pending;
  pending = [];
  pendingRows = 0;
  inFlight = flushBatch(frames).finally(() => {
    inFlight = null;
    // 在途期间攒下的帧立刻成为下一批
    if (pending.length > 0) void flushNow();
  });
  return inFlight;
}

/** 入队一帧；返回的 Promise 在明细落库后 resolve（附带该设备本批合并后的影子，失败为 null） */
export function enqueueIotTelemetry(frame: IotTelemetryFrame): Promise<IotReportedMergeResult | null> {
  return new Promise((resolve, reject) => {
    pending.push({ ...frame, resolve, reject });
    pendingRows += frame.rows.length;
    if (pendingRows >= MAX_PENDING_ROWS) {
      void flushNow();
    } else {
      scheduleFlush();
    }
  });
}

export function getIotIngestBufferStats() {
  return { pendingFrames: pending.length, pendingRows, flushing: inFlight !== null };
}

/** 停机排空：等待在途批次并把剩余帧写完 */
export async function flushIotIngestBuffer(): Promise<void> {
  while (inFlight || pending.length > 0) {
    await flushNow();
  }
}
