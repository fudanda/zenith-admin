import { SEED_RATE_PLANS } from '@arcbase/shared/seed';
import type { RatePlan } from '@arcbase/shared/open-platform';

export const mockRatePlans: RatePlan[] = SEED_RATE_PLANS.map((p) => ({ ...p }));
