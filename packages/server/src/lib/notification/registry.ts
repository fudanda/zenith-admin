/**
 * 通知渠道适配器注册表。
 *
 * 与 `lib/payment/registry.ts` 同构：适配器在 `initNotificationAdapters()` 中集中注册，
 * 派发器只通过 channel 查表。未注册的渠道不会静默丢消息，而是被记为
 * `channel_unavailable` 留痕——这样「配了渠道却没人收到」在派发日志里一眼可见。
 */
import type { NotificationChannel } from '@arcbase/shared/messaging';
import type { NotificationChannelAdapter } from './types';

const adapterRegistry = new Map<NotificationChannel, NotificationChannelAdapter>();

export function registerNotificationAdapter(adapter: NotificationChannelAdapter): void {
  adapterRegistry.set(adapter.channel, adapter);
}

export function getNotificationAdapter(channel: NotificationChannel): NotificationChannelAdapter | undefined {
  return adapterRegistry.get(channel);
}

export function hasNotificationAdapter(channel: NotificationChannel): boolean {
  return adapterRegistry.has(channel);
}

export function getRegisteredNotificationChannels(): NotificationChannel[] {
  return [...adapterRegistry.keys()];
}
