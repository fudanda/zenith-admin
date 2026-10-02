/** 通用审批文案集合：节点配置里的这些值视为"未定制"，办理节点按执行语义替换 */
const GENERIC_APPROVE_LABELS = new Set(['同意', '通过']);

const GENERIC_REJECT_LABELS = new Set(['拒绝', '驳回']);

/** 办理(handler)任务的动作文案：办理是执行动作而非审批意见，默认文案替换为「完成办理/无法办理」 */
export function resolveTaskActionLabel(
  displayName: string | undefined,
  key: 'approve' | 'reject',
  isHandlerTask: boolean,
): string {
  const generic = key === 'approve' ? GENERIC_APPROVE_LABELS : GENERIC_REJECT_LABELS;
  const fallback = key === 'approve' ? '同意' : '拒绝';
  const handlerLabel = key === 'approve' ? '完成办理' : '无法办理';
  const label = displayName ?? fallback;
  return isHandlerTask && generic.has(label) ? handlerLabel : label;
}
