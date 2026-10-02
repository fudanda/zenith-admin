/**
 * IoT 在线状态与设备接入鉴权。
 *
 * - 实时在线态 = Redis TTL 键存活（心跳/上报续期，WS 断开主动删除）
 * - 持久化在线标记 = iot_device_state.online，仅在上下线转变时更新，
 *   供事件打点与离线告警判定（HTTP 心跳设备的离线转变由周期扫描收敛）
 * - 一机一密 HMAC 签名：sign = HMAC-SHA256(secret, `${sn}\n${ts}\n${body}`) 的 hex，
 *   时间窗 ±300s 防重放；WS 握手 body 为空串
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { IOT_ONLINE_TTL_SECONDS, IOT_SIGN_MAX_SKEW_SECONDS } from '@arcbase/shared/iot';
import { db } from '../../db';
import { iotDevices, iotDeviceState, type IotDeviceRow } from '../../db/schema';
import redis from '../../lib/redis';
import logger from '../../lib/logger';
import { TtlCache } from '../../lib/ttl-cache';
import { recordIotLifecycleEvent } from './iot-events.service';
import { resolveIotOfflineAlarms } from './iot-alarms.service';

const ONLINE_PREFIX = 'iot:online:';
/** lastSeenAt 落库节流（秒）：心跳高频，只在超过该间隔时才 UPDATE */
const LAST_SEEN_FLUSH_SECONDS = 60;
/**
 * 设备行短缓存：接入每帧都要按 SN 取设备行验签，缓存把这次查询从热路径挪走；
 * TTL 内密钥重置 / 禁用最多延迟 10s 生效（本进程的管理端写操作会主动失效缓存）。
 * 未知 SN 也缓存（undefined），避免伪造 SN 的请求每次都打到数据库。
 */
const DEVICE_CACHE_TTL_MS = 10_000;
/** 在线 TTL 续期节流：TTL 90s，同一设备 30s 内只发一次 Redis 续期 */
const ONLINE_REFRESH_MIN_INTERVAL_MS = (IOT_ONLINE_TTL_SECONDS * 1000) / 3;

export function generateDeviceSn(): string {
  return `SN-${randomBytes(8).toString('hex').toUpperCase()}`;
}

export function generateDeviceSecret(): string {
  return randomBytes(24).toString('hex');
}

export function signDevicePayload(secret: string, sn: string, ts: string, body: string): string {
  return createHmac('sha256', secret).update(`${sn}\n${ts}\n${body}`).digest('hex');
}

// ─── 设备行缓存（按 SN）───────────────────────────────────────────────────────
/** 单飞 + 过期用旧值后台刷新 + 过期时刻抖动：几百台设备同刻过期也不会形成查库风暴 */
const deviceBySn = new TtlCache<string, IotDeviceRow | undefined>(DEVICE_CACHE_TTL_MS);

let deviceBySnStatement: { execute: (params: { sn: string }) => Promise<IotDeviceRow[]> } | null = null;

/** 预编译语句：跳过每帧重复的查询构造 */
function deviceBySnQuery() {
  deviceBySnStatement ??= db.select().from(iotDevices)
    .where(eq(iotDevices.sn, sql.placeholder('sn'))).limit(1)
    .prepare('iot_device_by_sn');
  return deviceBySnStatement;
}

function loadDeviceBySn(sn: string): Promise<IotDeviceRow | undefined> {
  return deviceBySn.get(sn, async () => (await deviceBySnQuery().execute({ sn }))[0]);
}

/** 管理端改动设备（密钥 / 状态 / 归属）后调用；不传 SN 则清空 */
export function invalidateIotDeviceAuthCache(sns?: string[]): void {
  if (!sns) {
    deviceBySn.clear();
    return;
  }
  for (const sn of sns) deviceBySn.delete(sn);
}

/** 校验设备签名并返回设备行（禁用设备拒绝接入） */
export async function authenticateDevice(sn: string | undefined, ts: string | undefined, sign: string | undefined, rawBody: string): Promise<IotDeviceRow> {
  if (!sn || !ts || !sign) throw new HTTPException(401, { message: '缺少设备签名头' });
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > IOT_SIGN_MAX_SKEW_SECONDS) {
    throw new HTTPException(401, { message: '签名时间戳超出允许窗口' });
  }
  const device = await loadDeviceBySn(sn);
  if (!device) throw new HTTPException(401, { message: '设备不存在' });
  const expected = signDevicePayload(device.secret, sn, ts, rawBody);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(sign, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new HTTPException(401, { message: '设备签名不合法' });
  }
  if (device.status !== 'enabled') throw new HTTPException(403, { message: '设备已禁用' });
  return device;
}

// ─── 在线状态 ─────────────────────────────────────────────────────────────────
/** 上次向 Redis 续期在线 TTL 的时刻（进程内）；下线 / 删除时清除 */
const lastOnlineRefresh = new Map<number, number>();

/** 续期在线 TTL；返回是否发生「离线 → 在线」转变（节流窗口内直接返回 false：键必然仍在 TTL 内） */
export async function markDeviceOnline(deviceId: number): Promise<boolean> {
  const now = Date.now();
  const last = lastOnlineRefresh.get(deviceId) ?? 0;
  if (now - last < ONLINE_REFRESH_MIN_INTERVAL_MS) return false;
  try {
    const pipeline = redis.pipeline();
    pipeline.exists(`${ONLINE_PREFIX}${deviceId}`);
    pipeline.setex(`${ONLINE_PREFIX}${deviceId}`, IOT_ONLINE_TTL_SECONDS, '1');
    const results = await pipeline.exec();
    lastOnlineRefresh.set(deviceId, now);
    return results?.[0]?.[1] !== 1;
  } catch (err) {
    logger.warn(`[iot] 在线态写入失败 deviceId=${deviceId}: ${(err as Error).message}`);
    return false;
  }
}

/** WS 断开即离线：删实时键 + 持久化标记转离线（HTTP 心跳设备的键会被其心跳重建） */
export async function markDeviceOffline(deviceId: number): Promise<void> {
  lastOnlineRefresh.delete(deviceId);
  try {
    await redis.del(`${ONLINE_PREFIX}${deviceId}`);
  } catch {
    // TTL 到期自然离线
  }
  try {
    const [changed] = await db.update(iotDeviceState)
      .set({ online: false })
      .where(and(eq(iotDeviceState.deviceId, deviceId), eq(iotDeviceState.online, true)))
      .returning({ deviceId: iotDeviceState.deviceId });
    if (changed) await recordIotLifecycleEvent(deviceId, 'offline');
  } catch (err) {
    logger.warn(`[iot] 离线标记更新失败 deviceId=${deviceId}: ${(err as Error).message}`);
  }
}

export async function isDeviceOnline(deviceId: number): Promise<boolean> {
  try {
    return (await redis.exists(`${ONLINE_PREFIX}${deviceId}`)) === 1;
  } catch {
    return false;
  }
}

/** 批量在线态（列表页）：Redis pipeline 一次取回 */
export async function getOnlineMap(deviceIds: number[]): Promise<Map<number, boolean>> {
  const map = new Map<number, boolean>();
  if (deviceIds.length === 0) return map;
  try {
    const pipeline = redis.pipeline();
    for (const id of deviceIds) pipeline.exists(`${ONLINE_PREFIX}${id}`);
    const results = await pipeline.exec();
    deviceIds.forEach((id, i) => map.set(id, results?.[i]?.[1] === 1));
  } catch {
    for (const id of deviceIds) map.set(id, false);
  }
  return map;
}

/** 「离线 → 在线」转变处理：持久化标记、事件打点（首次触达补激活）、恢复离线告警 */
async function handleOnlineTransition(device: IotDeviceRow): Promise<void> {
  await db.insert(iotDeviceState)
    .values({ deviceId: device.id, online: true })
    .onConflictDoUpdate({ target: iotDeviceState.deviceId, set: { online: true } });
  if (!device.activatedAt) await recordIotLifecycleEvent(device.id, 'activated');
  await recordIotLifecycleEvent(device.id, 'online');
  await resolveIotOfflineAlarms(device.id);
}

/**
 * 心跳/上报触达：续在线 TTL + 节流落库 lastSeenAt（首次触达补 activatedAt）。
 * 高频路径绕过 $onUpdate/审计 Proxy 的常规 update，走原生 SQL。
 */
export async function touchDevice(device: IotDeviceRow, opts?: { firmwareVersion?: string }): Promise<void> {
  const cameOnline = await markDeviceOnline(device.id);
  if (cameOnline) {
    await handleOnlineTransition(device).catch((err) => {
      logger.warn(`[iot] 上线转变处理失败 deviceId=${device.id}: ${(err as Error).message}`);
    });
  }
  // 网关触达顺带维持在线子设备的 TTL（只续期已在线的，不把离线子设备拉上线）
  if (device.nodeType === 'gateway') {
    void refreshGatewaySubTtl(device.id);
  }
  const now = Date.now();
  const stale = !device.lastSeenAt || now - device.lastSeenAt.getTime() > LAST_SEEN_FLUSH_SECONDS * 1000;
  const fwChanged = opts?.firmwareVersion && opts.firmwareVersion !== device.firmwareVersion;
  if (!stale && !fwChanged) return;
  try {
    await db.execute(sql`
      UPDATE iot_devices SET
        last_seen_at = now(),
        activated_at = COALESCE(activated_at, now())
        ${fwChanged ? sql`, firmware_version = ${opts!.firmwareVersion!}` : sql``}
      WHERE id = ${device.id}
    `);
    // 设备行来自短缓存，同步回写以免缓存期内每帧都判定为 stale / fwChanged 而重复 UPDATE
    device.lastSeenAt = new Date(now);
    device.activatedAt ??= new Date(now);
    if (fwChanged) device.firmwareVersion = opts!.firmwareVersion!;
  } catch (err) {
    logger.warn(`[iot] lastSeenAt 落库失败 deviceId=${device.id}: ${(err as Error).message}`);
  }
  if (fwChanged) {
    // 版本上报即 OTA 成功确认（动态引入避免 access→ota→devices→access 环）
    const { confirmIotOtaByVersion } = await import('./iot-ota.service');
    await confirmIotOtaByVersion(device.id, opts!.firmwareVersion!).catch((err) => {
      logger.warn(`[iot] OTA 版本确认失败 deviceId=${device.id}: ${(err as Error).message}`);
    });
  }
}

/** 供批量删除设备前清理实时键（防止残留幽灵在线态） */
export async function clearOnlineKeys(deviceIds: number[]): Promise<void> {
  if (deviceIds.length === 0) return;
  for (const id of deviceIds) lastOnlineRefresh.delete(id);
  try {
    await redis.del(...deviceIds.map((id) => `${ONLINE_PREFIX}${id}`));
  } catch {
    // TTL 自然过期
  }
}

// ─── 网关子设备 TTL 维持 ──────────────────────────────────────────────────────
const SUB_IDS_CACHE_TTL_MS = 30_000;

const gatewaySubIdsCache = new Map<number, { ids: number[]; expiresAt: number }>();

/** 网关触达时续期在线子设备（SET XX：仅已存在的键，30s 子设备清单缓存） */
async function refreshGatewaySubTtl(gatewayId: number): Promise<void> {
  try {
    const now = Date.now();
    let cached = gatewaySubIdsCache.get(gatewayId);
    if (!cached || cached.expiresAt <= now) {
      const rows = await db.select({ id: iotDevices.id }).from(iotDevices)
        .where(and(eq(iotDevices.gatewayId, gatewayId), eq(iotDevices.status, 'enabled')));
      cached = { ids: rows.map((r) => r.id), expiresAt: now + SUB_IDS_CACHE_TTL_MS };
      gatewaySubIdsCache.set(gatewayId, cached);
    }
    if (cached.ids.length === 0) return;
    const pipeline = redis.pipeline();
    for (const id of cached.ids) {
      pipeline.set(`${ONLINE_PREFIX}${id}`, '1', 'EX', IOT_ONLINE_TTL_SECONDS, 'XX');
    }
    await pipeline.exec();
  } catch (err) {
    logger.warn(`[iot] 网关子设备续期失败 gatewayId=${gatewayId}: ${(err as Error).message}`);
  }
}

