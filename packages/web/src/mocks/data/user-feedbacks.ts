import { SEED_USER_FEEDBACKS } from '@arcbase/shared/seed';
import type { UserFeedback } from '@arcbase/shared/platform';
import { nextIdFrom } from '@/mocks/utils/handlers';

// 从共享种子数据派生初始数据（与 DB seed 保持一致，禁止重复定义）
export const mockUserFeedbacks: UserFeedback[] = SEED_USER_FEEDBACKS.map((f) => ({ ...f }));

let nextUserFeedbackId = nextIdFrom(mockUserFeedbacks);
export function getNextUserFeedbackId(): number {
  return nextUserFeedbackId++;
}
