import type { BizPayDemo } from '@arcbase/shared/biz';
import { mockDateTime } from '@/mocks/utils/date';

export const mockBizPayDemos: BizPayDemo[] = [
  {
    id: 1, subject: '示例商品 A', amount: 9900, payMethod: 'wechat_native', status: 'paid',
    paymentOrderNo: 'PAYDEMO1700000000001', paidAt: '2026-06-20 10:12:00',
    fulfillRemark: '支付成功，已自动发放示例权益（演示履约）', tenantId: 1,
    createdAt: '2026-06-20 10:10:00', updatedAt: '2026-06-20 10:12:00',
  },
  {
    id: 2, subject: '示例服务开通', amount: 19900, payMethod: null, status: 'pending',
    paymentOrderNo: null, paidAt: null, fulfillRemark: null, tenantId: 1,
    createdAt: mockDateTime(), updatedAt: mockDateTime(),
  },
];

let nextId = 100;
export function getNextPayDemoId() { return nextId++; }
