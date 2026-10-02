/**
 * 通知（卡片）服务
 *
 * 供事件订阅器（工作流、系统告警等）在请求上下文之外，
 * 通过「系统号定向消息」推送卡片给指定用户。
 */
import type { ChatCard } from '@arcbase/shared/chat';
import { getSystemChannelId, publishTargeted } from '../messaging/channel.service';
import logger from '../../lib/logger';

/** 向某个用户推送一张卡片（经系统号定向消息） */
export async function notifyUserWithCard(userId: number, card: ChatCard): Promise<void> {
  try {
    const channelId = await getSystemChannelId();
    if (!channelId) {
      logger.warn('[chat-notify] 系统号不存在，已跳过卡片推送');
      return;
    }
    await publishTargeted(channelId, [userId], { type: 'card', content: card.title, extra: { card } });
  } catch (err) {
    logger.error('[chat-notify] notifyUserWithCard 失败', { err, userId });
  }
}

/** 向多个用户推送同一张卡片（一次发布、定向多人） */
export async function notifyUsersWithCard(userIds: number[], card: ChatCard): Promise<void> {
  try {
    const channelId = await getSystemChannelId();
    if (!channelId) return;
    await publishTargeted(channelId, userIds, { type: 'card', content: card.title, extra: { card } });
  } catch (err) {
    logger.error('[chat-notify] notifyUsersWithCard 失败', { err, userIds });
  }
}
