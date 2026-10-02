import type { MpKfAccount } from '@arcbase/shared/mp';
import { SEED_MP_KF_ACCOUNTS } from '@arcbase/shared/seed';
import { nextIdFrom } from '@/mocks/utils/handlers';

export const mockMpKfAccounts: MpKfAccount[] = SEED_MP_KF_ACCOUNTS.map((k) => ({ ...k }));

let nextId = nextIdFrom(mockMpKfAccounts);
export function getNextMpKfAccountId() {
  return nextId++;
}
