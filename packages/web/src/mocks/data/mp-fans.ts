import type { MpFan } from '@arcbase/shared/mp';
import { SEED_MP_FANS } from '@arcbase/shared/seed';

export const mockMpFans: MpFan[] = SEED_MP_FANS.map((f) => ({ ...f, tagIds: [...f.tagIds] }));
