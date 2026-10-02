import { SEED_INAPP_TEMPLATES } from '@arcbase/shared/seed';
import type { InAppTemplate } from '@arcbase/shared/messaging';
import { nextIdFrom } from '@/mocks/utils/handlers';

export const mockInAppTemplates: InAppTemplate[] = [...SEED_INAPP_TEMPLATES];

let nextId = nextIdFrom(mockInAppTemplates);
export function getNextInAppTemplateId() {
  return nextId++;
}
