import type { MpBroadcast } from '@arcbase/shared/mp';
import { SEED_MP_BROADCASTS } from '@arcbase/shared/seed';
import { nextIdFrom } from '@/mocks/utils/handlers';

export const mockMpBroadcasts: MpBroadcast[] = SEED_MP_BROADCASTS.map((b) => ({ ...b }));

let nextId = nextIdFrom(mockMpBroadcasts);
export function getNextMpBroadcastId() {
  return nextId++;
}
