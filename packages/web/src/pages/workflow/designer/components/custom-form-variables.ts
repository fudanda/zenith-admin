import type { WorkflowCustomFormVariable } from '@zenith/shared/workflow';

/** 变量 key 规范：字母/下划线开头，仅字母数字下划线（与表单字段 key、表达式 form.* 引用一致） */
export const CUSTOM_FORM_VARIABLE_KEY_PATTERN = /^[A-Za-z_$][\w$]*$/;

/**
 * 校验业务表单变量声明：key 格式非法 / 重复时返回错误文案（发布 gate 与面板内联提示共用）。
 * 空 key 行视为未完成配置，仅在发布校验时报错。
 */
export function validateCustomFormVariables(
  variables: WorkflowCustomFormVariable[] | null | undefined,
  options: { requireKey?: boolean } = {},
): string | null {
  const keys = (variables ?? []).map((v) => (v.key ?? '').trim());
  if (options.requireKey && keys.some((k) => !k)) return '存在未填写 key 的变量，请补全或删除';
  const filled = keys.filter(Boolean);
  const bad = filled.find((k) => !CUSTOM_FORM_VARIABLE_KEY_PATTERN.test(k));
  if (bad) return `变量 key「${bad}」格式非法：需以字母或下划线开头，仅含字母、数字、下划线`;
  const dup = filled.find((k, i) => filled.indexOf(k) !== i);
  if (dup) return `变量 key「${dup}」重复`;
  return null;
}
