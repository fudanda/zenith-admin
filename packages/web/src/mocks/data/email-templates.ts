import { SEED_EMAIL_TEMPLATES } from '@arcbase/shared/seed';
import type { EmailTemplate } from '@arcbase/shared/messaging';
import { nextIdFrom } from '@/mocks/utils/handlers';

export const mockEmailTemplates: EmailTemplate[] = [...SEED_EMAIL_TEMPLATES];

let nextId = nextIdFrom(mockEmailTemplates);
export function getNextEmailTemplateId() {
  return nextId++;
}
