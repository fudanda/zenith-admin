import type { MpMessage } from '@arcbase/shared/mp';
import { SEED_MP_MESSAGES } from '@arcbase/shared/seed';
import { nextIdFrom } from '@/mocks/utils/handlers';

export const mockMpMessages: MpMessage[] = SEED_MP_MESSAGES.map((m) => ({ ...m }));

let nextId = nextIdFrom(mockMpMessages);
export function getNextMpMessageId() {
  return nextId++;
}
