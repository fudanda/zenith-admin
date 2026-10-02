/**
 * IoT 管理端实时推送：设备遥测/影子/事件经既有管理端 WS 通道广播。
 *
 * 广播语义：帧带 deviceId，由前端按当前打开的设备详情过滤（平台设备规模下
 * 广播成本可忽略，避免自建订阅注册表）；按「帧类型 × 设备」300ms 节流，
 * 与任务中心推送口径一致。失败静默——实时推送是纯增强，轮询兜底仍在。
 */
import type { WsMessage } from '@arcbase/shared/platform';
import { broadcast } from '../../lib/ws-manager';
import logger from '../../lib/logger';

const PUSH_THROTTLE_MS = 300;

const lastPushAt = new Map<string, number>();

type IotRealtimeMessage = Extract<WsMessage, { type: 'iot:telemetry' | 'iot:shadow' | 'iot:device-event' }>;

export function pushIotRealtime(message: IotRealtimeMessage): void {
  try {
    const key = `${message.type}:${message.payload.deviceId}`;
    const now = Date.now();
    const last = lastPushAt.get(key) ?? 0;
    // 事件帧不节流（低频且每条都有业务含义），遥测/影子帧按设备节流
    if (message.type !== 'iot:device-event' && now - last < PUSH_THROTTLE_MS) return;
    lastPushAt.set(key, now);
    broadcast(message);
  } catch (err) {
    logger.debug?.(`[iot-realtime] 推送失败: ${(err as Error).message}`);
  }
}
