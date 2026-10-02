import type { MpMaterial } from '@arcbase/shared/mp';
import { SEED_MP_MATERIALS } from '@arcbase/shared/seed';
import { nextIdFrom } from '@/mocks/utils/handlers';

export const mockMpMaterials: MpMaterial[] = SEED_MP_MATERIALS.map((m) => ({ ...m }));

let nextId = nextIdFrom(mockMpMaterials);
export function getNextMpMaterialId() {
  return nextId++;
}
