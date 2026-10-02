/**
 * 运营群发任务(任务中心)。
 *
 * 分批(500/批)调用 notify() 派发 hidden 事件 messaging.broadcast:
 * 批次 dedupeKey `broadcast:{id}:batch:{n}` —— 断点重跑/自动重试不会重复入队,
 * 渠道投递失败由 outbox 自身的补投机制兜底,任务只负责「把事件登记完」。
 */
import { eq } from 'drizzle-orm';
import type { BroadcastChannel } from '@arcbase/shared/messaging';
import { db } from '../../db';
import { broadcastCampaigns } from '../../db/schema';
import { registerTaskHandler } from '../../lib/task-center';
import { notify } from './notification-outbox.service';
import { ensureBroadcastExists, resolveBroadcastAudience } from './broadcasts.service';

const BATCH_SIZE = 500;

export function registerBroadcastTaskHandlers(): void {
  registerTaskHandler({
    taskType: 'messaging-broadcast',
    title: '运营群发',
    module: '通知管理',
    allowConcurrent: true,
    maxAttempts: 3,
    retryDelayMs: 5000,
    async run(ctx) {
      const { campaignId } = ctx.payload as { campaignId: number };
      const campaign = await ensureBroadcastExists(campaignId);
      // sending=正常执行;failed=自动重试再入场;其余状态(已取消/已发送/草稿)跳过
      if (campaign.status !== 'sending' && campaign.status !== 'failed') {
        return { skipped: true, reason: `活动状态为 ${campaign.status}` };
      }
      if (campaign.status === 'failed') {
        await db.update(broadcastCampaigns)
          .set({ status: 'sending' })
          .where(eq(broadcastCampaigns.id, campaignId));
      }

      // 受众快照:重试/断点恢复时重算;dedupeKey 保证已入队批次不会重复
      const recipients = await resolveBroadcastAudience(campaign);
      await db.update(broadcastCampaigns)
        .set({ totalRecipients: recipients.length })
        .where(eq(broadcastCampaigns.id, campaignId));

      if (recipients.length === 0) {
        await db.update(broadcastCampaigns)
          .set({ status: 'sent', enqueuedCount: 0, sentAt: new Date() })
          .where(eq(broadcastCampaigns.id, campaignId));
        return { totalRecipients: 0, batches: 0 };
      }

      const totalBatches = Math.ceil(recipients.length / BATCH_SIZE);
      let batch = Number(ctx.checkpoint?.batch ?? 0);

      try {
        for (; batch < totalBatches; batch++) {
          const slice = recipients.slice(batch * BATCH_SIZE, (batch + 1) * BATCH_SIZE);
          await notify('messaging.broadcast', {
            recipients: slice,
            vars: { title: campaign.title, content: campaign.content },
            link: campaign.link,
            channelPolicy: { only: campaign.channels as BroadcastChannel[] },
            dedupeKey: `broadcast:${campaignId}:batch:${batch}`,
            tenantId: campaign.tenantId,
          });

          const enqueued = Math.min((batch + 1) * BATCH_SIZE, recipients.length);
          await db.update(broadcastCampaigns)
            .set({ enqueuedCount: enqueued })
            .where(eq(broadcastCampaigns.id, campaignId));

          const { cancelRequested } = await ctx.progress({
            processed: enqueued,
            total: recipients.length,
            note: `已入队 ${enqueued}/${recipients.length} 人`,
            checkpoint: { batch: batch + 1 },
          });
          if (cancelRequested) {
            await db.update(broadcastCampaigns)
              .set({ status: 'cancelled' })
              .where(eq(broadcastCampaigns.id, campaignId));
            return { cancelled: true, enqueued };
          }
        }
      } catch (err) {
        // 标记失败供列表呈现;自动重试入场时会翻回 sending 从断点继续
        await db.update(broadcastCampaigns)
          .set({ status: 'failed' })
          .where(eq(broadcastCampaigns.id, campaignId));
        throw err;
      }

      await db.update(broadcastCampaigns)
        .set({ status: 'sent', sentAt: new Date() })
        .where(eq(broadcastCampaigns.id, campaignId));
      return { totalRecipients: recipients.length, batches: totalBatches };
    },
  });
}
