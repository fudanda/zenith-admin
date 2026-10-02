/**
 * 行为面包屑环形缓冲：记录用户报错前的最近若干操作（导航/点击/网络/控制台），
 * 供错误上报时还原现场；同步写入会话回放录制流（播放器时间轴打点）。
 */
import type { ErrorBreadcrumb } from '@arcbase/shared/analytics';
import { addReplayCustomEvent } from './replay';

const MAX_BREADCRUMBS = 30;
const buffer: ErrorBreadcrumb[] = [];

export function addBreadcrumb(b: Omit<ErrorBreadcrumb, 'timestamp'> & { timestamp?: string }): void {
  const crumb = { ...b, timestamp: b.timestamp ?? new Date().toISOString() };
  buffer.push(crumb);
  if (buffer.length > MAX_BREADCRUMBS) buffer.shift();
  // 回放录制中时同步为 rrweb 自定义事件（idle 时 no-op）
  addReplayCustomEvent('breadcrumb', crumb);
}

export function getBreadcrumbs(): ErrorBreadcrumb[] {
  return [...buffer];
}

export function clearBreadcrumbs(): void {
  buffer.length = 0;
}
