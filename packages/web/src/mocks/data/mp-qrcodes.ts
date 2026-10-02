import type { MpQrcode } from '@arcbase/shared/mp';
import { SEED_MP_QRCODES } from '@arcbase/shared/seed';
import { nextIdFrom } from '@/mocks/utils/handlers';

export const mockMpQrcodes: MpQrcode[] = SEED_MP_QRCODES.map((q) => ({ ...q }));

let nextId = nextIdFrom(mockMpQrcodes);
export function getNextMpQrcodeId() {
  return nextId++;
}
