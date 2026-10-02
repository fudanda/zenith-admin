/**
 * 报表数据集参数与行级权限：运行时参数解析、系统变量注入、绑定参数编译与行级规则拼接。
 * 对外统一经 report-dataset.service.ts facade 暴露。
 */
import { HTTPException } from 'hono/http-exception';
import { eq, sql, type SQL } from 'drizzle-orm';
import { db } from '../../db';
import { users } from '../../db/schema';
import { currentUserOrNull } from '../../lib/context';
import { getEffectiveTenantId } from '../../lib/tenant';
import type { ReportDatasetParam, ReportFieldType, ReportRowRule } from '@arcbase/shared/report';

function coerceParam(value: unknown, type: ReportFieldType): unknown {
  if (value === null || value === undefined || value === '') return null;
  if (type === 'number') { const n = Number(value); return Number.isFinite(n) ? n : null; }
  if (type === 'boolean') return value === true || value === 'true' || value === 1 || value === '1';
  return String(value);
}

/** 解析有效参数：数据集默认值 + 运行时传入，required 校验。`__` 前缀为系统变量保留命名空间，剥离客户端伪造值 */
export function resolveDatasetParams(defs: ReportDatasetParam[] | undefined, provided?: Record<string, unknown>): Record<string, unknown> {
  const safeProvided = Object.fromEntries(
    Object.entries(provided ?? {}).filter(([k]) => !k.startsWith('__')),
  );
  const defsList = defs ?? [];
  const allowed = new Set(defsList.map((item) => item.name));
  const extraKeys = Object.keys(safeProvided).filter((key) => !allowed.has(key));
  if (extraKeys.length) {
    throw new HTTPException(400, { message: `存在未声明的运行参数：${extraKeys.join('、')}` });
  }
  const out: Record<string, unknown> = {};
  for (const d of defsList) {
    if (d.name.startsWith('__')) continue;
    const raw = safeProvided[d.name];
    const val = (raw === undefined || raw === null || raw === '') ? (d.defaultValue ?? null) : coerceParam(raw, d.type);
    out[d.name] = val;
    if (d.required && (val === null || val === undefined)) {
      throw new HTTPException(400, { message: `缺少必填参数：${d.label || d.name}` });
    }
  }
  return out;
}

/**
 * 数据权限系统变量（JEECG 风格）：以绑定参数注入当前登录用户上下文，
 * 供数据集 SQL 通过 ${__userId} / ${__deptId} 等做行级过滤。
 * 这些变量由服务端权威赋值，客户端无法伪造（始终覆盖同名入参）。
 *
 * 仅注入 SQL 文本**实际引用**的变量（按需注入）：
 * - 未引用任何系统变量的公共数据集，其结果与用户无关 —— 不注入可让结果缓存跨用户复用（大屏降压）；
 * - API / 静态数据集（sqlText 为空）不注入 —— 防止内部用户 ID/用户名/租户 ID 混入外发的第三方 HTTP 请求参数。
 */
export async function buildSystemParams(sqlText: string): Promise<Record<string, unknown>> {
  const referenced = new Set<string>();
  for (const m of sqlText.matchAll(/\$\{\s*(__\w+)\s*\}/g)) referenced.add(m[1]);
  if (referenced.size === 0) return {};
  const user = currentUserOrNull();
  const out: Record<string, unknown> = {};
  if (referenced.has('__userId')) out.__userId = user?.userId ?? null;
  if (referenced.has('__username')) out.__username = user?.username ?? null;
  if (referenced.has('__tenantId')) out.__tenantId = user ? getEffectiveTenantId(user) : null;
  if (referenced.has('__deptId')) {
    if (user) {
      const [row] = await db.select({ deptId: users.departmentId }).from(users).where(eq(users.id, user.userId)).limit(1);
      out.__deptId = row?.deptId ?? null;
    } else {
      out.__deptId = null;
    }
  }
  return out;
}

/** 把 ${name} 编译为绑定参数（防注入）；未提供的绑定 null */
export function buildParamSql(text: string, params: Record<string, unknown>): SQL {
  const segments = text.split(/\$\{\s*(\w+)\s*\}/g);
  const chunks: SQL[] = [];
  for (let i = 0; i < segments.length; i++) {
    if (i % 2 === 0) {
      if (segments[i]) chunks.push(sql.raw(segments[i]));
    } else {
      const v = params[segments[i]];
      chunks.push(sql`${v === undefined ? null : v}`);
    }
  }
  return sql.join(chunks, sql.raw(''));
}

/** 外部库 ${name} → 占位符（pg=$N / mysql=? / sqlserver=@pN）+ values 数组（防注入）*/
export function buildExternalParamSql(
  text: string,
  params: Record<string, unknown>,
  dialect: 'mysql' | 'postgresql' | 'sqlserver',
): { text: string; values: unknown[] } {
  const segments = text.split(/\$\{\s*(\w+)\s*\}/g);
  let out = '';
  const values: unknown[] = [];
  for (let i = 0; i < segments.length; i++) {
    if (i % 2 === 0) { out += segments[i]; continue; }
    const v = params[segments[i]];
    values.push(v === undefined ? null : v);
    if (dialect === 'postgresql') out += `$${values.length}`;
    else if (dialect === 'sqlserver') out += `@p${values.length - 1}`;
    else out += '?';
  }
  return { text: out, values };
}

// ─── 行级权限（Row-Level Rules）────────────────────────────────────────────────

/**
 * 解析当前用户命中的行级规则：
 * - 规则未启用 / where 为空或含分号（防拼接多语句）→ 忽略；
 * - 无用户上下文 → 拒绝执行；未命中任何规则 → 注入恒假条件（失败关闭）；
 * - 超级管理员不受限；规则未配置 roles = 对所有登录用户生效。
 */
export function resolveEffectiveRowRules(rules: ReportRowRule[] | null | undefined): ReportRowRule[] {
  const list = (rules ?? []).filter((r) =>
    (r.enabled ?? true) && typeof r.where === 'string' && r.where.trim() && !r.where.includes(';'));
  if (!list.length) return [];
  const user = currentUserOrNull();
  if (!user) {
    throw new HTTPException(403, { message: '该数据集配置了行级权限，当前执行缺少用户身份' });
  }
  const roles = user.roles ?? [];
  if (roles.includes('super_admin')) return [];
  const matched = list.filter((r) => !r.roles?.length || r.roles.some((code) => roles.includes(code)));
  return matched.length ? matched : [{ where: '1 = 0', enabled: true, remark: '未命中任何行级权限规则，默认拒绝' }];
}

/** 把命中的行级规则以 OR 拼接为 WHERE，包裹原查询（子查询别名 _rls；PG/MySQL/SQL Server 通用） */
export function applyRowRulesToSql(sqlText: string, rules: ReportRowRule[]): string {
  if (!rules.length) return sqlText;
  const where = rules.map((r) => `(${r.where.trim()})`).join(' OR ');
  return `SELECT * FROM (\n${sqlText.trim().replace(/;\s*$/, '')}\n) AS _rls WHERE ${where}`;
}
