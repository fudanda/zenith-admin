import type { MpAutoReply } from '@arcbase/shared/mp';
import { SEED_MP_AUTO_REPLIES } from '@arcbase/shared/seed';
import { nextIdFrom } from '@/mocks/utils/handlers';

export const mockMpAutoReplies: MpAutoReply[] = SEED_MP_AUTO_REPLIES.map((r) => ({ ...r }));

let nextId = nextIdFrom(mockMpAutoReplies);
export function getNextMpAutoReplyId() {
  return nextId++;
}
