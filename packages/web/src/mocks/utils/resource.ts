import type { HttpHandler } from 'msw';
import type * as z from 'zod';
import { filterMetaMap, type AnyOperation, type FilterMeta } from '@arcbase/shared/core';
import { mock, MockHttpError, type MockContext } from './contract';
import { removeByIds, requireItem } from './crud';
import { mockDateTime } from './date';
import { badRequest, nextIdFrom } from './handlers';
import { includesKeyword, matchesFilter, withinDateRange } from './filter';

/**
 * 标准资源的 Mock handler 派生：按契约上存在的 list / detail / create / update / remove / removeBatch
 * 生成内存 CRUD，列表筛选由契约 query 的 `x-filter` 语义驱动——
 * keyword 按 `keyword` 声明的字段模糊匹配，enum / bool / id 与行上同名字段精确匹配（`matchesFilter`），
 * 成对的时间端点按 `dateField`（默认 `createdAt`）做闭区间；`match` 覆盖某个键的取值方式。
 * 自定义操作（启停 / 同步 / 导出…）继续用 `mock(op, resolver)` 与派生结果拼在同一数组里。
 *
 * @example
 * export const tagsHandlers = [
 *   ...mockResource(tagContract, {
 *     store: mockTags,
 *     notFound: '标签不存在',
 *     keyword: (t) => [t.name, t.description],
 *     unique: { field: 'name', message: '标签名称已存在' },
 *     create: (body, id, now) => ({ id, ...body, color: body.color ?? null, createdAt: now, updatedAt: now }),
 *   }),
 *   mock(tagContract.groups, ({ ok }) => ok(getTagGroups())),
 * ];
 */

type IdLike = number | string;
type Row = { id: IdLike; createdAt?: string; updatedAt?: string };

/** 工厂接受的契约形态：标准操作可缺省 */
export interface MockResourceContract {
  readonly basePath: string;
  readonly list?: AnyOperation;
  readonly detail?: AnyOperation;
  readonly create?: AnyOperation;
  readonly update?: AnyOperation;
  readonly remove?: AnyOperation;
  readonly removeBatch?: AnyOperation;
}

type OpOf<C, K extends keyof C> = C[K] extends AnyOperation ? C[K] : never;
type QueryOutput<Op> = Op extends AnyOperation ? (Op['query'] extends z.ZodType ? z.output<Op['query']> : Record<string, never>) : Record<string, never>;
type BodyOutput<Op> = Op extends AnyOperation ? (Op['body'] extends z.ZodType ? z.output<Op['body']> : never) : never;

export type MockOpName = 'list' | 'detail' | 'create' | 'update' | 'remove' | 'removeBatch';

export interface MockResourceOptions<C extends MockResourceContract, T extends Row> {
  /** 内存行（可变数组，创建 / 删除直接改它） */
  readonly store: T[];
  readonly notFound: string;
  /** 关键字匹配的行字段（对应契约 `keywordQuery`）；缺省匹配 `name` */
  readonly keyword?: (item: T) => Array<string | number | boolean | null | undefined>;
  /** 覆盖某个筛选键的行取值（默认取行上同名字段） */
  readonly match?: Partial<Record<keyof QueryOutput<OpOf<C, 'list'>> & string, (item: T) => unknown>>;
  /** 时间范围筛选作用的行字段；缺省 `createdAt` */
  readonly dateField?: (item: T) => string | null | undefined;
  /** 契约之外的额外筛选 */
  readonly filter?: (item: T, query: QueryOutput<OpOf<C, 'list'>>) => boolean;
  /** 列表排序；缺省保持插入顺序 */
  readonly sort?: (a: T, b: T) => number;
  /** 唯一字段校验（创建 / 更新时重复即 400） */
  readonly unique?: { readonly field: keyof T & string; readonly message: string };
  /** 请求体 → 新行；缺省 `{ id, ...body, createdAt: now, updatedAt: now }` */
  readonly create?: (body: BodyOutput<OpOf<C, 'create'>>, id: T['id'], now: string, ctx: MockContext<OpOf<C, 'create'>>) => T;
  /** 就地更新；缺省 `Object.assign(item, body, { updatedAt: now })` */
  readonly update?: (item: T, body: BodyOutput<OpOf<C, 'update'>>, now: string) => void;
  /** 删除前校验（内置行不可删等）：返回错误文案即 400 */
  readonly beforeRemove?: (item: T) => string | undefined;
  readonly messages?: { readonly create?: string; readonly update?: string; readonly remove?: string; readonly removeBatch?: (count: number) => string };
  /** 需要自定义 handler 的标准操作：排除后由调用方 `mock(op, ...)` 显式书写 */
  readonly exclude?: readonly MockOpName[];
}

function pickFilter<T>(meta: FilterMeta | undefined, key: string, value: unknown, item: T, options: { keyword?: (item: T) => unknown[]; match?: Record<string, ((item: T) => unknown) | undefined> }): boolean {
  if (value === undefined || value === null || value === '') return true;
  const getter = options.match?.[key];
  const actual = getter ? getter(item) : (item as Record<string, unknown>)[key];
  if (meta?.kind === 'keyword') {
    const fields = options.keyword ? options.keyword(item) : [(item as Record<string, unknown>).name];
    return includesKeyword(String(value), ...(fields as Array<string | number | boolean | null | undefined>));
  }
  if (meta?.kind === 'bool') return matchesFilter(Boolean(actual), value as boolean);
  return matchesFilter(actual as unknown, value as never);
}

export function mockResource<C extends MockResourceContract, T extends Row>(contract: C, options: MockResourceOptions<C, T>): HttpHandler[] {
  const { store, notFound, exclude = [] } = options;
  const handlers: HttpHandler[] = [];
  const has = (name: MockOpName) => Boolean(contract[name]) && !exclude.includes(name);
  const unique = (candidate: Record<string, unknown>, except?: T) => {
    if (!options.unique) return undefined;
    const value = candidate[options.unique.field];
    if (value === undefined) return undefined;
    return store.some((row) => row !== except && (row as Record<string, unknown>)[options.unique!.field] === value) ? options.unique.message : undefined;
  };

  if (has('list')) {
    const op = contract.list as AnyOperation;
    const metas = op.query ? filterMetaMap(op.query as z.ZodObject<z.ZodRawShape>) : {};
    const bounds = Object.entries(metas).filter(([, m]) => m.kind === 'date-bound');
    const start = bounds.find(([, m]) => m.kind === 'date-bound' && m.bound === 'start')?.[0];
    const end = bounds.find(([, m]) => m.kind === 'date-bound' && m.bound === 'end')?.[0];
    handlers.push(mock(op, ({ query, ok, paginate }) => {
      const q = (query ?? {}) as Record<string, unknown>;
      const dateOf = options.dateField ?? ((item: T) => item.createdAt);
      let rows = store.filter((item) => {
        for (const [key, value] of Object.entries(q)) {
          if (key === 'page' || key === 'pageSize' || key === start || key === end) continue;
          if (!pickFilter(metas[key], key, value, item, options as never)) return false;
        }
        if ((start || end) && !withinDateRange(dateOf(item), start ? (q[start] as string | undefined) : undefined, end ? (q[end] as string | undefined) : undefined)) return false;
        return options.filter ? options.filter(item, q as never) : true;
      });
      if (options.sort) rows = [...rows].sort(options.sort);
      return ok(paginate(rows) as never);
    }));
  }
  if (has('detail')) {
    handlers.push(mock(contract.detail as AnyOperation, ({ params, ok }) => ok(requireItem(store, (params as { id: T['id'] }).id, notFound, { status: 404 }) as never)));
  }
  if (has('create')) {
    handlers.push(mock(contract.create as AnyOperation, (ctx) => {
      const body = ctx.body as Record<string, unknown>;
      const dup = unique(body);
      if (dup) return badRequest(dup, { status: 400 });
      const now = mockDateTime();
      const id = (typeof store[0]?.id === 'string' ? `${Date.now()}` : nextIdFrom(store as Array<{ id: number }>)) as T['id'];
      const row = options.create ? options.create(body as never, id, now, ctx as never) : ({ id, ...body, createdAt: now, updatedAt: now } as unknown as T);
      store.push(row);
      return ctx.ok(row as never, options.messages?.create ?? '创建成功');
    }));
  }
  if (has('update')) {
    handlers.push(mock(contract.update as AnyOperation, ({ params, body, ok }) => {
      const item = requireItem(store, (params as { id: T['id'] }).id, notFound, { status: 404 });
      const dup = unique(body as Record<string, unknown>, item);
      if (dup) return badRequest(dup, { status: 400 });
      const now = mockDateTime();
      if (options.update) options.update(item, body as never, now);
      else Object.assign(item, body, { updatedAt: now });
      return ok(item as never, options.messages?.update ?? '更新成功');
    }));
  }
  // `DELETE /batch` 必须先于 `DELETE /{id}` 注册
  if (has('removeBatch')) {
    handlers.push(mock(contract.removeBatch as AnyOperation, ({ body, ok }) => {
      const ids = (body as { ids: T['id'][] }).ids;
      for (const id of ids) {
        const item = store.find((row) => row.id === id);
        const blocked = item && options.beforeRemove?.(item);
        if (blocked) throw new MockHttpError(badRequest(blocked, { status: 400 }));
      }
      const count = removeByIds(store, ids);
      return ok(null as never, options.messages?.removeBatch ? options.messages.removeBatch(count) : '批量删除成功');
    }));
  }
  if (has('remove')) {
    handlers.push(mock(contract.remove as AnyOperation, ({ params, ok }) => {
      const item = requireItem(store, (params as { id: T['id'] }).id, notFound, { status: 404 });
      const blocked = options.beforeRemove?.(item);
      if (blocked) return badRequest(blocked, { status: 400 });
      removeByIds(store, [item.id]);
      return ok(null as never, options.messages?.remove ?? '删除成功');
    }));
  }
  return handlers;
}
