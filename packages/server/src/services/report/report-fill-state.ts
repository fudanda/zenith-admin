import { HTTPException } from 'hono/http-exception';
import type { ReportFillRecordStatus } from '@arcbase/shared/report';

export type ReportFillRecordAction = 'edit' | 'submit' | 'cancel' | 'review';

const ALLOWED_ACTION_STATUSES: Record<ReportFillRecordAction, readonly ReportFillRecordStatus[]> = {
  edit: ['draft', 'rejected'],
  submit: ['draft', 'rejected'],
  cancel: ['draft', 'rejected', 'submitted', 'in_review'],
  review: ['submitted', 'in_review'],
};

export function isReportFillRecordActionAllowed(
  status: ReportFillRecordStatus,
  action: ReportFillRecordAction,
): boolean {
  return ALLOWED_ACTION_STATUSES[action].includes(status);
}

export function assertReportFillRecordRevision(actual: number, expected: number): void {
  if (actual !== expected) {
    throw new HTTPException(409, { message: '记录已被其他操作更新，请刷新后重试' });
  }
}
