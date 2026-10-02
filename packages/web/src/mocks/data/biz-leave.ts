import type { BizLeave } from '@arcbase/shared/biz';
import { mockDate, mockDateTime } from '@/mocks/utils/date';

export const mockBizLeaves: BizLeave[] = [
  {
    id: 1, leaveType: 'annual', startDate: '2026-06-20', endDate: '2026-06-22', days: 3,
    reason: '家庭旅行', status: 'approved', workflowInstanceId: 9001, workflowStatus: 'approved',
    applicantId: 1, applicantName: '管理员', tenantId: 1, createdAt: '2026-06-15 09:00:00', updatedAt: '2026-06-16 10:00:00',
  },
  {
    id: 2, leaveType: 'sick', startDate: mockDate(), endDate: mockDate(), days: 1,
    reason: '感冒发烧', status: 'pending', workflowInstanceId: 9002, workflowStatus: 'running',
    applicantId: 1, applicantName: '管理员', tenantId: 1, createdAt: mockDateTime(), updatedAt: mockDateTime(),
  },
  {
    id: 3, leaveType: 'personal', startDate: '2026-07-01', endDate: '2026-07-02', days: 2,
    reason: '办理证件', status: 'draft', workflowInstanceId: null, workflowStatus: null,
    applicantId: 1, applicantName: '管理员', tenantId: 1, createdAt: mockDateTime(), updatedAt: mockDateTime(),
  },
];

let nextLeaveId = 100;
let nextLeaveInstanceId = 9100;
export function getNextLeaveId() { return nextLeaveId++; }
export function getNextLeaveInstanceId() { return nextLeaveInstanceId++; }
