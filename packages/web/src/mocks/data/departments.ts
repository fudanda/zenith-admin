import type { Department } from '@arcbase/shared/identity';
import { SEED_DEPARTMENTS } from '@arcbase/shared/seed';

export const mockDepartments: Department[] = SEED_DEPARTMENTS.map((d) => ({ ...d }));

let nextDeptId = SEED_DEPARTMENTS.length + 1;
export function getNextDeptId() {
  return nextDeptId++;
}
