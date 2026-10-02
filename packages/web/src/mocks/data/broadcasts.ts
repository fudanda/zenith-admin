/**
 * 运营群发 Mock 数据(Demo 模式)。
 */
import type { BroadcastCampaign } from '@arcbase/shared/messaging';
import { mockDateTime } from '@/mocks/utils/date';
import { nextIdFrom } from '@/mocks/utils/handlers';

const now = mockDateTime();

export const mockBroadcasts: BroadcastCampaign[] = [
  {
    id: 1,
    title: '五一假期服务安排',
    content: '五一期间客服响应时间调整为 9:00-18:00,紧急问题请走工单加急通道。',
    link: '/announcements',
    channels: ['inapp', 'push'],
    audienceType: 'all_users',
    audienceIds: [],
    status: 'sent',
    totalRecipients: 128,
    enqueuedCount: 128,
    taskId: null,
    sentAt: now,
    remark: null,
    createdBy: 1,
    createdByName: '管理员',
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 2,
    title: '新版本功能上线预告',
    content: '移动端 2.0 将于下周发布,支持生物识别登录与离线审批,敬请期待。',
    link: null,
    channels: ['inapp'],
    audienceType: 'member_ids',
    audienceIds: [1, 2, 3],
    status: 'draft',
    totalRecipients: null,
    enqueuedCount: 0,
    taskId: null,
    sentAt: null,
    remark: '等运营确认文案后发送',
    createdBy: 1,
    createdByName: '管理员',
    createdAt: now,
    updatedAt: now,
  },
];

let nextBroadcastId = nextIdFrom(mockBroadcasts);
export function getNextBroadcastId(): number {
  return nextBroadcastId++;
}
