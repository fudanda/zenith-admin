import type { AsyncTaskItemStatus, AsyncTaskStatus } from '@arcbase/shared/tasks';

/** 异步任务状态 → Tag 颜色/文案（任务中心与业务 Demo 页共用） */
export const ASYNC_TASK_STATUS_TAG_MAP = {
  pending: { color: 'blue', label: '排队中' },
  running: { color: 'cyan', label: '执行中' },
  success: { color: 'green', label: '已完成' },
  failed: { color: 'red', label: '失败' },
  cancelled: { color: 'grey', label: '已取消' },
} as const satisfies Record<AsyncTaskStatus, { color: 'blue' | 'cyan' | 'green' | 'red' | 'grey'; label: string }>;

/** 异步任务子项状态 → Tag 颜色/文案 */
export const ASYNC_TASK_ITEM_STATUS_TAG_MAP = {
  pending: { color: 'blue', label: '待处理' },
  success: { color: 'green', label: '成功' },
  failed: { color: 'red', label: '失败' },
  skipped: { color: 'grey', label: '跳过' },
} as const satisfies Record<AsyncTaskItemStatus, { color: 'blue' | 'green' | 'red' | 'grey'; label: string }>;

/** 成功率着色：低于 90% 视为需要关注（任务统计与任务类型页签共用） */
export function asyncTaskRateColor(rate: number | null): string {
  if (rate === null) return 'var(--semi-color-text-2)';
  if (rate >= 99) return 'var(--semi-color-success)';
  if (rate >= 90) return 'var(--semi-color-warning)';
  return 'var(--semi-color-danger)';
}
