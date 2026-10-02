import type { WorkflowDefinition } from '@arcbase/shared/workflow';

/** 是否可在轻页发起：仅设计器表单（业务自定义表单需到桌面端）；发起人自选审批人已由轻页选人组件支持 */
export function canLaunchOnMobile(def: WorkflowDefinition): boolean {
  return def.formType === 'designer';
}
