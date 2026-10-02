/**
 * 动态默认值解析：将字段 defaultValue 中的 ${currentUser} 等占位符
 * 按发起人/部门/时间解析为初始值，供发起页注入。
 */
import dayjs from 'dayjs';
import type { WorkflowFormField } from '@arcbase/shared/workflow';
import { flattenAllFields } from './form-tree';

export interface DynamicDefaultContext {
  userName?: string;
  userId?: number | string;
  deptName?: string;
  deptId?: number | string;
}

const subAll = (input: string, find: string, replacement: string): string => input.split(find).join(replacement);

const TOKEN_RE = /\$\{(?:currentUser|currentUserId|currentDept|currentDeptId|today|now)\}/;

export function resolveDefaultToken(raw: string, ctx: DynamicDefaultContext): string {
  let s = raw;
  s = subAll(s, '${currentUserId}', ctx.userId != null ? String(ctx.userId) : '');
  s = subAll(s, '${currentUser}', ctx.userName ?? '');
  s = subAll(s, '${currentDeptId}', ctx.deptId != null ? String(ctx.deptId) : '');
  s = subAll(s, '${currentDept}', ctx.deptName ?? '');
  s = subAll(s, '${today}', dayjs().format('YYYY-MM-DD'));
  s = subAll(s, '${now}', dayjs().format('YYYY-MM-DD HH:mm:ss'));
  return s;
}

/** 收集所有含动态占位符的字段默认值，解析为初始值对象 */
export function resolveDynamicDefaults(
  fields: WorkflowFormField[],
  ctx: DynamicDefaultContext,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of flattenAllFields(fields)) {
    if (typeof f.defaultValue === 'string' && TOKEN_RE.test(f.defaultValue)) {
      out[f.key] = resolveDefaultToken(f.defaultValue, ctx);
    }
  }
  return out;
}
