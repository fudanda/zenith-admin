import { eq, inArray, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type * as z from 'zod';
import type { AnyOperation, PaginatedResponse, QueryOutputOf } from '@arcbase/shared/core';
import { db } from '../db';
import { requireFirstRow, requireRow } from './db-assert';
import { toPgUniqueViolationError } from './db-errors';
import { listRows } from './list-query';
import { currentCreateTenantId, tenantScope } from './tenant';
import { buildWhere } from './where-helpers';

/**
 * 标准资源的 CRUD Service 工厂：以契约为类型来源，把「取行断言 / 列表编排 / 插入 / 更新 / 删除 / 批量删除」
 * 六个标准操作按同一套规则生成，资源只声明差异——筛选条件、行 → 实体映射、写入换算与业务钩子。
 *
 * - **可见范围只声明一次**：`scope`（或 `tenant: true` = `tenantScope(table)` + 插入时补 `tenantId`）对
 *   detail / update / remove / removeBatch / list 全部生效，结构上杜绝「列表套了租户、详情没套」的漏洞。
 * - **类型从契约来**：列表入参 = `QueryOutputOf<contract.list>`，创建 / 更新入参 = 契约 body 的解析输出，
 *   返回实体 = 契约 `detail` 响应；`map` 返回值不满足实体 schema 时在编译期报错。
 * - **钩子不开事务**：`before* / after*` 只做校验、派生与副作用（缓存失效、事件发布）；需要跨表事务、
 *   自定义响应形状或钩子超过两个的资源不用本工厂，写显式 Service（见 crud-backend.md 适用判据）。
 *
 * @example
 * export const tagService = defineCrudService(tagContract, {
 *   table: tags,
 *   map: entityMapper(tagSchema),
 *   notFound: '标签不存在',
 *   unique: '标签名称已存在',
 *   list: (q) => ({
 *     where: [keywordCondition(q.keyword, [tags.name, tags.description]), q.status ? eq(tags.status, q.status) : undefined],
 *     orderBy: [asc(tags.sortOrder), asc(tags.id)],
 *   }),
 * });
 * export const { list: listTags, get: getTag, ensure: ensureTagExists } = tagService;
 */

/** 工厂接受的契约形态：标准操作可缺省（缺省的操作对应的方法入参类型为 never） */
export interface CrudContractLike {
  readonly basePath: string;
  readonly list?: AnyOperation;
  readonly detail?: AnyOperation;
  readonly create?: AnyOperation;
  readonly update?: AnyOperation;
  readonly remove?: AnyOperation;
  readonly removeBatch?: AnyOperation;
}

/** 带整数主键 `id` 的表 */
export type CrudTable = PgTable & { readonly id: PgColumn };

type BodyOutputOf<Op> = Op extends { readonly body: infer B } ? (B extends z.ZodType ? z.output<B> : never) : never;
type ResponseOutputOf<Op> = Op extends AnyOperation ? z.output<Op['response']> : never;
type ListItemOf<Op> = ResponseOutputOf<Op> extends { list: (infer Item)[] } ? Item : ResponseOutputOf<Op> extends (infer Item)[] ? Item : never;
type ParamsOutputOf<Op> = Op extends { readonly params: infer P } ? (P extends z.ZodType ? z.output<P> : never) : never;

/** 契约实体：依次取 `detail` 响应、`create` / `update` 响应、`list` 的行 */
export type CrudEntityOf<C extends CrudContractLike> = C['detail'] extends AnyOperation
  ? ResponseOutputOf<C['detail']>
  : C['create'] extends AnyOperation
    ? ResponseOutputOf<C['create']>
    : C['update'] extends AnyOperation
      ? ResponseOutputOf<C['update']>
      : ListItemOf<C['list']>;
/**
 * 逐操作的契约响应：路由派生时服务函数按各自操作对照（列表行 / 详情实体 / 创建与更新的返回可以是不同 schema，
 * 如 `paginated(xxxSchema)` + `xxxDetailSchema`）。缺 `detail` 的契约 `get` 只服务于审计快照，返回值不约束。
 */
export type CrudListResponseOf<C extends CrudContractLike> = ResponseOutputOf<C['list']>;
export type CrudDetailOf<C extends CrudContractLike> = C['detail'] extends AnyOperation ? ResponseOutputOf<C['detail']> : unknown;
export type CrudCreateResponseOf<C extends CrudContractLike> = ResponseOutputOf<C['create']>;
export type CrudUpdateResponseOf<C extends CrudContractLike> = ResponseOutputOf<C['update']>;
/** 主键类型：取 `detail` / `update` / `remove` 的 `params.id`（缺省 number；UUID 资源为 string） */
export type CrudIdOf<C extends CrudContractLike> = ParamsOutputOf<C['detail'] extends AnyOperation ? C['detail'] : C['update'] extends AnyOperation ? C['update'] : C['remove']> extends { id: infer Id } ? Id : number;
export type CrudListQueryOf<C extends CrudContractLike> = C['list'] extends AnyOperation ? QueryOutputOf<C['list']> : never;
export type CrudCreateInputOf<C extends CrudContractLike> = BodyOutputOf<C['create']>;
export type CrudUpdateInputOf<C extends CrudContractLike> = BodyOutputOf<C['update']>;

type Row<T extends CrudTable> = T['$inferSelect'];
type Insert<T extends CrudTable> = T['$inferInsert'];
type MaybePromise<T> = T | Promise<T>;

export interface CrudListSpec {
  /** 筛选条件（含 `undefined`，由 `buildWhere` 过滤）；可见范围由工厂追加，不必重复写 */
  readonly where?: ReadonlyArray<SQL | undefined>;
  readonly orderBy: ReadonlyArray<SQL | PgColumn>;
}

export interface CrudCreateSpec<T extends CrudTable, TInput, TEntity> {
  /** 入参 → 插入值；缺省把入参原样作为插入值（入参形状必须能直接落库） */
  readonly toRow?: (input: TInput) => MaybePromise<Insert<T>>;
  /** 插入前：校验 / 预检（SSRF、引用存在性…） */
  readonly before?: (input: TInput) => MaybePromise<void>;
  /** 插入后副作用（缓存失效、事件发布） */
  readonly after?: (entity: TEntity, row: Row<T>) => MaybePromise<void>;
}

export interface CrudUpdateSpec<T extends CrudTable, TInput, TEntity> {
  /** 入参 → 更新值；缺省原样。声明后（或声明 `before`）更新前会先按可见范围取出现有行 */
  readonly toRow?: (input: TInput, existing: Row<T>) => MaybePromise<Partial<Insert<T>>>;
  readonly before?: (input: TInput, existing: Row<T>) => MaybePromise<void>;
  readonly after?: (entity: TEntity, row: Row<T>) => MaybePromise<void>;
}

export interface CrudRemoveSpec<T extends CrudTable> {
  /** 删除前：引用检查 / 系统内置保护；批量删除逐行调用 */
  readonly before?: (existing: Row<T>) => MaybePromise<void>;
  readonly after?: (existing: Row<T>) => MaybePromise<void>;
}

export interface CrudServiceConfig<C extends CrudContractLike, T extends CrudTable> {
  readonly table: T;
  /** 行 → 契约实体（通常 `entityMapper(xxxSchema, …)`） */
  readonly map: (row: Row<T>) => MaybePromise<CrudEntityOf<C>>;
  /** 取不到行时的 404 文案 */
  readonly notFound: string;
  /** 唯一约束冲突时的提示；同表多个唯一约束用 `byConstraint` 精准区分 */
  readonly unique?: string | { readonly message: string; readonly byConstraint?: Readonly<Record<string, string>> };
  /**
   * 租户隔离：读写一律追加 `tenantScope(table)`，插入补 `tenantId: currentCreateTenantId()`。
   * 表必须有 `tenantId` 列；更细的可见范围用 `scope`
   */
  readonly tenant?: T extends { readonly tenantId: PgColumn } ? boolean : never;
  /** 自定义可见范围（数据权限、站点归属…）：每次调用求值，返回 `undefined` 表示不限制 */
  readonly scope?: () => SQL | undefined;
  /** 插入时自动补的列（`tenant: true` 已含 `tenantId`） */
  readonly defaults?: () => Partial<Insert<T>>;
  /** 列表筛选与排序 */
  readonly list: (query: CrudListQueryOf<C>) => CrudListSpec;
  readonly create?: CrudCreateSpec<T, CrudCreateInputOf<C>, CrudEntityOf<C>>;
  readonly update?: CrudUpdateSpec<T, CrudUpdateInputOf<C>, CrudEntityOf<C>>;
  readonly remove?: CrudRemoveSpec<T>;
}

export interface CrudService<C extends CrudContractLike, T extends CrudTable> {
  readonly table: T;
  readonly map: (row: Row<T>) => MaybePromise<CrudEntityOf<C>>;
  /** 当前可见范围条件（含 tenant / scope），供同模块自定义查询复用 */
  readonly scope: () => SQL | undefined;
  /** `id` + 可见范围的行条件 */
  readonly whereId: (id: number) => SQL;
  /** 取行，不存在（或不可见）抛 404 */
  readonly ensure: (id: number) => Promise<Row<T>>;
  readonly get: (id: number) => Promise<CrudEntityOf<C>>;
  readonly list: (query: CrudListQueryOf<C>) => Promise<PaginatedResponse<CrudEntityOf<C>>>;
  readonly create: (input: CrudCreateInputOf<C>) => Promise<CrudEntityOf<C>>;
  readonly update: (id: number, input: CrudUpdateInputOf<C>) => Promise<CrudEntityOf<C>>;
  readonly remove: (id: number) => Promise<void>;
  /** 批量删除：只删可见范围内的行；返回实际删除数 */
  readonly removeMany: (ids: readonly number[]) => Promise<number>;
  /** 审计前快照：按 id 列表取可见行并映射为实体 */
  readonly snapshot: (ids: readonly number[]) => Promise<CrudEntityOf<C>[]>;
}

export function defineCrudService<C extends CrudContractLike, T extends CrudTable>(
  _contract: C,
  config: CrudServiceConfig<C, T>,
): CrudService<C, T> {
  const { table, map, notFound } = config;
  const unique = typeof config.unique === 'string' ? { message: config.unique } : config.unique;
  // 泛型表在 Drizzle 的条件类型上无法收窄，内部按基类操作，行类型由 $inferSelect 还原
  const base = table as PgTable;
  const idColumn = table.id;

  const scope = (): SQL | undefined => buildWhere(config.tenant ? tenantScope(table as unknown as { tenantId: PgColumn }) : undefined, config.scope?.());
  const whereId = (id: number): SQL => buildWhere(eq(idColumn, id), scope())!;
  const uniqueError = (err: unknown): unknown => (unique ? toPgUniqueViolationError(err, unique.message, unique.byConstraint) : err);

  const ensure = (id: number) => requireFirstRow(db.select().from(base).where(whereId(id)).limit(1) as unknown as Promise<Row<T>[]>, notFound);

  const get = async (id: number) => map(await ensure(id));

  const list = (query: CrudListQueryOf<C>) => {
    const spec = config.list(query);
    return listRows<T, CrudEntityOf<C>>({
      page: query.page,
      pageSize: query.pageSize,
      table,
      where: buildWhere(...(spec.where ?? []), scope()),
      orderBy: spec.orderBy,
      map,
    });
  };

  const insertRow = async (values: Insert<T>): Promise<Row<T>> => {
    try {
      const [row] = await db.insert(base).values(values as never).returning() as unknown as Row<T>[];
      return row;
    } catch (err) {
      throw uniqueError(err);
    }
  };

  const updateRow = async (id: number, values: Partial<Insert<T>>): Promise<Row<T>> => {
    try {
      const [row] = await db.update(base).set(values as never).where(whereId(id)).returning() as unknown as Row<T>[];
      return requireRow(row, notFound);
    } catch (err) {
      throw uniqueError(err);
    }
  };

  const create = async (input: CrudCreateInputOf<C>) => {
    await config.create?.before?.(input);
    const values = {
      ...(config.tenant ? { tenantId: currentCreateTenantId() } : {}),
      ...config.defaults?.(),
      ...(config.create?.toRow ? await config.create.toRow(input) : (input as Insert<T>)),
    } as Insert<T>;
    const row = await insertRow(values);
    const entity = await map(row);
    await config.create?.after?.(entity, row);
    return entity;
  };

  const update = async (id: number, input: CrudUpdateInputOf<C>) => {
    const needExisting = Boolean(config.update?.before || config.update?.toRow);
    const existing = needExisting ? await ensure(id) : undefined;
    if (existing) await config.update?.before?.(input, existing);
    const values = existing && config.update?.toRow ? await config.update.toRow(input, existing) : (input as Partial<Insert<T>>);
    const updated = await updateRow(id, values);
    const entity = await map(updated);
    await config.update?.after?.(entity, updated);
    return entity;
  };

  const remove = async (id: number) => {
    const hooks = config.remove;
    const existing = hooks ? await ensure(id) : undefined;
    if (existing) await hooks?.before?.(existing);
    const [row] = await db.delete(base).where(whereId(id)).returning() as unknown as Row<T>[];
    const removed = requireRow(row, notFound);
    await hooks?.after?.(existing ?? removed);
  };

  const removeMany = async (ids: readonly number[]) => {
    if (ids.length === 0) return 0;
    const where = buildWhere(inArray(idColumn, [...ids]), scope());
    const hooks = config.remove;
    if (hooks) {
      const rows = await db.select().from(base).where(where) as unknown as Row<T>[];
      for (const row of rows) await hooks.before?.(row);
      const deleted = await db.delete(base).where(where).returning() as unknown as Row<T>[];
      for (const row of deleted) await hooks.after?.(row);
      return deleted.length;
    }
    const deleted = await db.delete(base).where(where).returning({ id: idColumn });
    return deleted.length;
  };

  const snapshot = async (ids: readonly number[]) => {
    if (ids.length === 0) return [];
    const rows = await db.select().from(base).where(buildWhere(inArray(idColumn, [...ids]), scope())) as unknown as Row<T>[];
    return Promise.all(rows.map((row) => map(row)));
  };

  return { table, map, scope, whereId, ensure, get, list, create, update, remove, removeMany, snapshot };
}
