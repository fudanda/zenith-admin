/**
 * 请假业务的工作流事件订阅者
 *
 * 监听 biz_leave 类型流程的终态事件，回写请假单状态（仿 payment-subscribers）。
 * 事件处理在请求上下文之外异步触发，审计 Proxy 会自动跳过 createdBy/updatedBy 注入。
 */
import { eq } from 'drizzle-orm';
import type { BizLeaveStatus } from '@arcbase/shared/biz';
import { db } from '../../db';
import { bizLeaves } from '../../db/schema';
import logger from '../../lib/logger';
import { onWorkflowResult } from '../../lib/workflow-biz-bridge';
import { BIZ_LEAVE_TYPE } from './biz-leave.service';

let registered = false;

export function registerBizLeaveSubscribers(): void {
  if (registered) return;
  registered = true;

  onWorkflowResult(BIZ_LEAVE_TYPE, {
    onApproved: (instance) => updateLeaveStatus(instance.bizId, 'approved', instance.status),
    onRejected: (instance) => updateLeaveStatus(instance.bizId, 'rejected', instance.status),
    onWithdrawn: (instance) => updateLeaveStatus(instance.bizId, 'cancelled', instance.status),
  });

  logger.info('Biz-leave workflow subscribers registered');
}

async function updateLeaveStatus(bizId: string | null | undefined, status: BizLeaveStatus, workflowStatus: string): Promise<void> {
  if (!bizId) return;
  const leaveId = Number(bizId);
  if (!Number.isInteger(leaveId)) return;
  try {
    await db.update(bizLeaves).set({ status, workflowStatus }).where(eq(bizLeaves.id, leaveId));
  } catch (err) {
    logger.error('[biz-leave] 流程回写状态失败', { leaveId, status, err });
  }
}
