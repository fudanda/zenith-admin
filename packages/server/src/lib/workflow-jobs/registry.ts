import type { WorkflowJobType } from '@arcbase/shared/workflow';
import type { WorkflowJobHandler } from './types';

/**
 * jobType → handler 注册表。
 * handler 模块在被 import 时调用 registerJobHandler 自注册；
 * lib/workflow-jobs/handlers/index.ts 汇总 import 触发注册。
 */
const registry = new Map<WorkflowJobType, WorkflowJobHandler>();

export function registerJobHandler(jobType: WorkflowJobType, handler: WorkflowJobHandler): void {
  if (registry.has(jobType)) {
    throw new Error(`workflow job handler already registered for "${jobType}"`);
  }
  registry.set(jobType, handler);
}

export function getJobHandler(jobType: WorkflowJobType): WorkflowJobHandler | undefined {
  return registry.get(jobType);
}

export function getRegisteredJobTypes(): WorkflowJobType[] {
  return [...registry.keys()];
}
