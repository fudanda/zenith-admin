import { SEED_WORKFLOW_CATEGORIES } from '@arcbase/shared/seed';
import type { WorkflowCategory } from '@arcbase/shared/workflow';
import { mockDateTime } from '@/mocks/utils/date';
import { nextIdFrom } from '@/mocks/utils/handlers';

export const mockWorkflowCategories: WorkflowCategory[] = SEED_WORKFLOW_CATEGORIES.map((c) => ({
  ...c,
  createdAt: mockDateTime(c.createdAt),
  updatedAt: mockDateTime(c.updatedAt),
}));

let nextCategoryId = nextIdFrom(mockWorkflowCategories);
export function getNextCategoryId(): number {
  return nextCategoryId++;
}
