import { SEED_API_SCOPES } from '@arcbase/shared/seed';
import type { ApiScope } from '@arcbase/shared/open-platform';

export const mockApiScopes: ApiScope[] = SEED_API_SCOPES.map((s) => ({ ...s }));
