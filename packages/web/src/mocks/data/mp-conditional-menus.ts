import type { MpConditionalMenu } from '@arcbase/shared/mp';
import { SEED_MP_CONDITIONAL_MENUS } from '@arcbase/shared/seed';
import { mockDateTime } from '@/mocks/utils/date';
import { nextIdFrom } from '@/mocks/utils/handlers';

export const mockMpConditionalMenus: MpConditionalMenu[] = SEED_MP_CONDITIONAL_MENUS.map((m) => ({
  id: m.id,
  accountId: m.accountId,
  name: m.name,
  buttons: m.buttons,
  matchRule: m.matchRule,
  menuId: null,
  status: m.status,
  publishedAt: null,
  createdAt: mockDateTime(),
  updatedAt: mockDateTime(),
}));

let nextId = nextIdFrom(mockMpConditionalMenus);
export function getNextMpConditionalMenuId() { return nextId++; }
