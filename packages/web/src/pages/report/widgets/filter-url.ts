/**
 * 仪表盘筛选值 ↔ URL query 序列化（纯函数，查看页/公开页共用）。
 * 规则：数组型（multiSelect / daterange / numberRange）JSON 编码；标量转字符串；空值不占用 URL。
 */
import type { ReportFilter } from '@arcbase/shared/report';

/** 筛选值 → URL 参数字符串；返回 null 表示应从 URL 删除该 key */
export function encodeFilterValue(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (Array.isArray(value)) {
    if (value.length === 0 || value.every((v) => v === undefined || v === null || v === '')) return null;
    return JSON.stringify(value);
  }
  return String(value);
}

/** URL 参数字符串 → 筛选值（按筛选器类型还原数组/标量） */
export function decodeFilterValue(raw: string, filter: ReportFilter): unknown {
  const isArrayType = filter.type === 'multiSelect' || filter.type === 'daterange' || filter.type === 'numberRange';
  if (!isArrayType) return raw;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* 非 JSON 时按单值兜底 */ }
  return filter.type === 'multiSelect' ? [raw] : undefined;
}

/** 从 URL 初始化整组筛选值：URL 优先，其次筛选器默认值 */
export function filterValuesFromSearch(
  filters: ReportFilter[],
  searchParams: URLSearchParams,
  defaultOf: (f: ReportFilter) => unknown,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const f of filters) {
    const raw = searchParams.get(f.id);
    values[f.id] = raw != null ? decodeFilterValue(raw, f) : defaultOf(f);
  }
  return values;
}

/** 把单个筛选值写回 URLSearchParams（返回新实例，供 setSearchParams 使用） */
export function withFilterParam(prev: URLSearchParams, filterId: string, value: unknown): URLSearchParams {
  const next = new URLSearchParams(prev);
  const encoded = encodeFilterValue(value);
  if (encoded === null) next.delete(filterId);
  else next.set(filterId, encoded);
  return next;
}
