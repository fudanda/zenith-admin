/**
 * 行为中心阶段 1：事件/画像属性过滤条件 → 安全 SQL 片段的公共转换。
 *
 * 供 analytics-event-query.service（事件分析工作台）、analytics-conversion.service（有序漏斗）、
 * analytics-segments.service（分群圈选）三处复用，避免各自重复实现且保持同一套注入防护规则：
 *  - key 必须匹配严格白名单正则，禁止 sql.raw(用户输入)
 *  - 所有比较值均以绑定参数传入，从不拼接进 SQL 文本
 */
import { sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { HTTPException } from 'hono/http-exception';
import type { AnalyticsSegmentPropertyFilter, AnalyticsSegmentCompareOp } from '@arcbase/shared/analytics';
import { ANALYTICS_PROPERTY_KEY_PATTERN } from '@arcbase/shared/analytics';

/** 属性 key 白名单：与 shared 层同源，禁止各写一份（漂移会造成前端放行、服务端 400） */
export const PROPERTY_KEY_RE = ANALYTICS_PROPERTY_KEY_PATTERN;

function ensureInArrayValues(value: unknown): unknown[] {
  const values = Array.isArray(value) ? value : [value];
  if (values.length === 0 || values.length > 100) {
    throw new HTTPException(400, { message: 'in 运算符的取值数组长度需在 1~100 之间' });
  }
  return values;
}

/** 通用比较 SQL：expr 可为 jsonb ->> 表达式或直接列，统一按需 cast 后比较，值均绑定参数化 */
function compareExpr(expr: SQL, op: AnalyticsSegmentCompareOp, value: unknown): SQL {
  switch (op) {
    case 'eq':
      return sql`(${expr}) = ${String(value)}`;
    case 'neq':
      return sql`((${expr}) IS NULL OR (${expr}) != ${String(value)})`;
    case 'gt':
      return sql`(${expr})::numeric > ${Number(value)}`;
    case 'gte':
      return sql`(${expr})::numeric >= ${Number(value)}`;
    case 'lt':
      return sql`(${expr})::numeric < ${Number(value)}`;
    case 'lte':
      return sql`(${expr})::numeric <= ${Number(value)}`;
    case 'in': {
      const values = ensureInArrayValues(value);
      return sql`(${expr}) IN (${sql.join(values.map((v) => sql`${String(v)}`), sql`, `)})`;
    }
    default:
      throw new HTTPException(400, { message: `不支持的比较运算符：${op as string}` });
  }
}

/**
 * 除 `neq` 外，所有运算符都要求 `properties ->> key` 非空，即该 key 必然存在，
 * 因此可以安全地前置一个 `properties ? key` 合取项：它被原条件蕴含，不改变结果集，
 * 但能命中 `properties` 上的 GIN 索引（默认 jsonb_ops 支持 `?`），把「时间窗内逐行求值
 * jsonb 表达式」降级为位图索引扫描 + 精确重查。
 *
 * `neq` 语义上包含「该 key 不存在」的行（`IS NULL OR != value`），键存在并不被蕴含，
 * 加上该合取项会漏掉这些行，故必须排除。
 */
function keyExistenceIsImplied(op: AnalyticsSegmentCompareOp): boolean {
  return op !== 'neq';
}

/**
 * jsonb 属性过滤条件（`properties ->> key`）→ 安全 SQL；key 需匹配 {@link PROPERTY_KEY_RE}。
 * `column` 必须是 jsonb 类型列（如 userEvents.properties / analyticsUserProfiles.properties）。
 */
export function buildJsonPropertyCondition(column: PgColumn, filter: AnalyticsSegmentPropertyFilter): SQL {
  if (!PROPERTY_KEY_RE.test(filter.key)) {
    throw new HTTPException(400, { message: `非法的属性 key：${filter.key}` });
  }
  const expr = sql`(${column} ->> ${filter.key})`;
  const compare = compareExpr(expr, filter.op, filter.value);
  if (!keyExistenceIsImplied(filter.op)) return compare;
  // key 显式 ::text：`?` 的右操作数若是未定型参数，PG 会在运算符解析阶段报 "operator is not unique"
  return sql`(${column} ? ${filter.key}::text) AND ${compare}`;
}

/** 直接列比较（枚举/数值列，如 identityType / userId / memberId），文本化比较以统一处理枚举与数值。 */
export function buildColumnCompareCondition(column: PgColumn, op: AnalyticsSegmentCompareOp, value: unknown): SQL {
  return compareExpr(sql`${column}::text`, op, value);
}
