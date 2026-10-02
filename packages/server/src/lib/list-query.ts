import type { SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { PaginatedResponse } from '@arcbase/shared/core';
import { db } from '../db';
import { withPagination } from './where-helpers';

export interface ListPageInput<Row, Item = Row> {
  page: number;
  pageSize: number;
  /** 总数查询：`() => db.$count(table, where)` 或自定义聚合 count */
  count: () => Promise<number>;
  /** 当前页行查询：自带 where / orderBy / `withPagination` 或 `pageOffset` */
  rows: () => Promise<Row[]>;
  /** 行 → 契约实体；可为异步（需要补充关联数据时） */
  map?: (row: Row) => Item | Promise<Item>;
}

/**
 * 分页列表结果编排：count 与 rows 并行发出，映射后套上 `{ list, total, page, pageSize }` 包络。
 * 只负责编排，不改动任何 SQL——条件、排序、投影仍由调用方在 `count` / `rows` 里显式书写。
 *
 * @example
 * return buildListResult({
 *   page, pageSize,
 *   count: () => db.$count(tags, where),
 *   rows: () => withPagination(db.select().from(tags).where(where).orderBy(desc(tags.id)).$dynamic(), page, pageSize),
 *   map: mapTag,
 * });
 */
export async function buildListResult<Row, Item = Row>({ page, pageSize, count, rows, map }: ListPageInput<Row, Item>): Promise<PaginatedResponse<Item>> {
  const [total, rawRows] = await Promise.all([count(), rows()]);
  const list = map ? await Promise.all(rawRows.map((row) => map(row))) : (rawRows as unknown as Item[]);
  return { list, total, page, pageSize };
}

/**
 * 空结果短路：可见范围为空（`accessibleIds.length === 0`）等无需查库的情形，直接返回空的分页包络。
 *
 * @example
 * if (accessibleIds?.length === 0) return emptyListResult(page, pageSize);
 */
export function emptyListResult<Item = never>(page: number, pageSize: number): PaginatedResponse<Item> {
  return { list: [], total: 0, page, pageSize };
}

export interface ListRowsInput<TTable extends PgTable, Item> {
  page: number;
  pageSize: number;
  table: TTable;
  /** 列表筛选 + 隔离条件，通常来自 `buildWhere(...)`；count 与 rows 结构上共用同一份 */
  where: SQL | undefined;
  /** 排序列 / 表达式，按顺序生效：`[asc(t.sortOrder), asc(t.id)]` */
  orderBy: readonly (SQL | PgColumn)[];
  map?: (row: TTable['$inferSelect']) => Item | Promise<Item>;
}

/**
 * 单表、全行、无 join 的标准列表：`db.$count(table, where)` + `select().from(table).where(where).orderBy(...)` 分页，
 * 再经 `buildListResult` 并行编排。只覆盖这一种形态——带 join / 投影 / 聚合 count / 行后处理的列表继续写 `buildListResult`。
 *
 * @example
 * return listRows({ page, pageSize, table: tags, where, orderBy: [desc(tags.id)], map: mapTag });
 */
export function listRows<TTable extends PgTable, Item = TTable['$inferSelect']>(
  { page, pageSize, table, where, orderBy, map }: ListRowsInput<TTable, Item>,
): Promise<PaginatedResponse<Item>> {
  return buildListResult<TTable['$inferSelect'], Item>({
    page,
    pageSize,
    count: () => db.$count(table, where),
    // 泛型表在 from() 的条件类型上无法收窄，按基类传入后由 $inferSelect 还原行类型
    rows: () => withPagination(db.select().from(table as PgTable).where(where).orderBy(...orderBy).$dynamic(), page, pageSize) as unknown as Promise<TTable['$inferSelect'][]>,
    map,
  });
}
