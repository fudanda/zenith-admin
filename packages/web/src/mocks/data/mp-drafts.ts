import type { MpDraft } from '@arcbase/shared/mp';
import { SEED_MP_DRAFTS } from '@arcbase/shared/seed';
import { nextIdFrom } from '@/mocks/utils/handlers';

export const mockMpDrafts: MpDraft[] = SEED_MP_DRAFTS.map((d) => ({ ...d, articles: JSON.parse(JSON.stringify(d.articles)) }));

let nextId = nextIdFrom(mockMpDrafts);
export function getNextMpDraftId() {
  return nextId++;
}
