import { describe, expect, expectTypeOf, it, vi, beforeEach } from 'vitest';
import * as z from 'zod';
import { asc, eq, sql, type SQL } from 'drizzle-orm';
import { integer, pgTable, varchar, PgDialect } from 'drizzle-orm/pg-core';
import { HTTPException } from 'hono/http-exception';
import { defineContract, op, idParam, paginated, paginationQuery, keywordQuery, batchIdsBody, partialForUpdate, type PaginatedResponse } from '@arcbase/shared/core';
import { defineCrudService } from './crud-service';

// ─── db 桩：记录每次调用的链式参数 ───────────────────────────────────────────

interface Call { kind: string; table?: unknown; where?: SQL | undefined; values?: unknown; set?: unknown }

const dbMock = vi.hoisted(() => {
  const calls: Call[] = [];
  const state = { selectRows: [] as unknown[], insertRows: [] as unknown[], updateRows: [] as unknown[], deleteRows: [] as unknown[], insertError: undefined as unknown, count: 0 };
  const chain = (kind: string) => {
    const call: Call = { kind };
    calls.push(call);
    const q: Record<string, unknown> = {};
    const self = () => q;
    Object.assign(q, {
      from: (t: unknown) => { call.table = t; return q; },
      where: (w: SQL | undefined) => { call.where = w; return q; },
      limit: self, offset: self, orderBy: self, $dynamic: self,
      values: (v: unknown) => { call.values = v; return q; },
      set: (v: unknown) => { call.set = v; return q; },
      returning: () => q,
      then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
        if (kind === 'insert' && state.insertError) return reject(state.insertError);
        const rows = kind === 'select' ? state.selectRows : kind === 'insert' ? state.insertRows : kind === 'update' ? state.updateRows : state.deleteRows;
        return resolve(rows);
      },
    });
    return q;
  };
  return {
    calls,
    state,
    db: {
      select: () => chain('select'),
      insert: (t: unknown) => { const q = chain('insert'); (calls.at(-1) as Call).table = t; return q; },
      update: (t: unknown) => { const q = chain('update'); (calls.at(-1) as Call).table = t; return q; },
      delete: (t: unknown) => { const q = chain('delete'); (calls.at(-1) as Call).table = t; return q; },
      $count: async () => state.count,
    },
  };
});
vi.mock('../db', () => ({ db: dbMock.db }));

const tenantMock = vi.hoisted(() => ({ scope: undefined as SQL | undefined, createTenantId: null as number | null }));
vi.mock('./tenant', () => ({
  tenantScope: () => tenantMock.scope,
  currentCreateTenantId: () => tenantMock.createTenantId,
}));

const dialect = new PgDialect();
const render = (s: SQL | undefined) => (s ? dialect.sqlToQuery(s) : undefined);

// ─── 契约与表 ────────────────────────────────────────────────────────────────

const tags = pgTable('tags', {
  id: integer().primaryKey(),
  tenantId: integer(),
  name: varchar({ length: 32 }).notNull(),
  remark: varchar({ length: 256 }),
});

const tagSchema = z.object({ id: z.int(), name: z.string(), remark: z.string().nullable() });
const createTagSchema = z.object({ name: z.string(), remark: z.string().nullable().optional() });
const tagContract = defineContract('/api/test-tags', {
  list: op.get('/', { access: 'authenticated', query: paginationQuery.extend({ keyword: keywordQuery('名称') }), response: paginated(tagSchema), summary: 'list' }),
  detail: op.get('/{id}', { access: 'authenticated', params: idParam, response: tagSchema, summary: 'detail' }),
  create: op.post('/', { access: 'authenticated', body: createTagSchema, response: tagSchema, summary: 'create' }),
  update: op.put('/{id}', { access: 'authenticated', params: idParam, body: partialForUpdate(createTagSchema), response: tagSchema, summary: 'update' }),
  removeBatch: op.delete('/batch', { access: 'authenticated', body: batchIdsBody, summary: 'removeBatch' }),
  remove: op.delete('/{id}', { access: 'authenticated', params: idParam, summary: 'remove' }),
});

const mapTag = (row: typeof tags.$inferSelect) => ({ id: row.id, name: row.name, remark: row.remark ?? null });

function makeService(extra: Partial<Parameters<typeof defineCrudService<typeof tagContract, typeof tags>>[1]> = {}) {
  return defineCrudService(tagContract, {
    table: tags,
    map: mapTag,
    notFound: '标签不存在',
    unique: '标签名称已存在',
    list: (q) => ({ where: [q.keyword ? eq(tags.name, q.keyword) : undefined], orderBy: [asc(tags.id)] }),
    ...extra,
  });
}

beforeEach(() => {
  dbMock.calls.length = 0;
  Object.assign(dbMock.state, { selectRows: [], insertRows: [], updateRows: [], deleteRows: [], insertError: undefined, count: 0 });
  tenantMock.scope = undefined;
  tenantMock.createTenantId = null;
});

describe('defineCrudService · 类型从契约派生', () => {
  it('list / get / create / update 的入参与返回值即契约类型', () => {
    const service = makeService();
    expectTypeOf(service.list).returns.resolves.toEqualTypeOf<PaginatedResponse<{ id: number; name: string; remark: string | null }>>();
    expectTypeOf(service.get).returns.resolves.toEqualTypeOf<{ id: number; name: string; remark: string | null }>();
    expectTypeOf(service.create).parameter(0).toEqualTypeOf<{ name: string; remark?: string | null | undefined }>();
    expectTypeOf(service.update).parameter(1).toEqualTypeOf<{ name?: string | undefined; remark?: string | null | undefined }>();
    expectTypeOf(service.list).parameter(0).toMatchTypeOf<{ page: number; pageSize: number; keyword?: string | undefined }>();
  });

  it('map 返回值不满足契约实体时不编译', () => {
    defineCrudService(tagContract, {
      table: tags,
      // @ts-expect-error 缺 remark
      map: (row) => ({ id: row.id, name: row.name }),
      notFound: 'x',
      list: () => ({ orderBy: [asc(tags.id)] }),
    });
  });
});

describe('defineCrudService · 读', () => {
  it('ensure：按 id 取行，缺失抛 404；get 经 map', async () => {
    const service = makeService();
    dbMock.state.selectRows = [{ id: 3, tenantId: null, name: 'a', remark: null }];
    expect(await service.get(3)).toEqual({ id: 3, name: 'a', remark: null });
    expect(render(dbMock.calls[0].where)?.sql).toBe('"tags"."id" = $1');

    dbMock.state.selectRows = [];
    await expect(service.ensure(9)).rejects.toMatchObject({ status: 404, message: '标签不存在' });
  });

  it('tenant: true 时读写条件都追加租户范围，list 的筛选与范围合并', async () => {
    tenantMock.scope = sql`"tags"."tenant_id" = 7`;
    const service = makeService({ tenant: true });
    dbMock.state.selectRows = [{ id: 1, tenantId: 7, name: 'a', remark: null }];
    await service.ensure(1);
    expect(render(dbMock.calls[0].where)?.sql).toBe('("tags"."id" = $1 and "tags"."tenant_id" = 7)');

    dbMock.calls.length = 0;
    dbMock.state.count = 1;
    const result = await service.list({ page: 1, pageSize: 10, keyword: 'a' });
    expect(result).toEqual({ list: [{ id: 1, name: 'a', remark: null }], total: 1, page: 1, pageSize: 10 });
    const selectCall = dbMock.calls.find((c) => c.kind === 'select');
    expect(render(selectCall?.where)?.sql).toBe('("tags"."name" = $1 and "tags"."tenant_id" = 7)');
  });

  it('scope 自定义可见范围与 tenant 叠加；snapshot 只取范围内的行', async () => {
    tenantMock.scope = sql`t = 1`;
    const service = makeService({ tenant: true, scope: () => sql`owner = 5` });
    dbMock.state.selectRows = [{ id: 1, tenantId: 1, name: 'a', remark: 'r' }];
    expect(await service.snapshot([1, 2])).toEqual([{ id: 1, name: 'a', remark: 'r' }]);
    expect(render(dbMock.calls[0].where)?.sql).toBe('("tags"."id" in ($1, $2) and (t = 1 and owner = 5))');
    expect(await service.snapshot([])).toEqual([]);
  });
});

describe('defineCrudService · 写', () => {
  it('create：before → 插入（补租户与 defaults）→ map → after；toRow 换算入参', async () => {
    const order: string[] = [];
    tenantMock.createTenantId = 7;
    const service = makeService({
      tenant: true,
      defaults: () => ({ remark: 'default' }),
      create: {
        before: async (input) => { order.push(`before:${input.name}`); },
        toRow: (input) => ({ name: input.name.toUpperCase(), remark: input.remark ?? null }),
        after: async (entity) => { order.push(`after:${entity.name}`); },
      },
    });
    dbMock.state.insertRows = [{ id: 10, tenantId: 7, name: 'A', remark: null }];
    const created = await service.create({ name: 'a' });
    expect(created).toEqual({ id: 10, name: 'A', remark: null });
    expect(dbMock.calls[0]).toMatchObject({ kind: 'insert', values: { tenantId: 7, remark: null, name: 'A' } });
    expect(order).toEqual(['before:a', 'after:A']);
  });

  it('create：唯一约束冲突映射为 400 业务错误，其它错误原样抛出', async () => {
    const service = makeService();
    dbMock.state.insertError = Object.assign(new Error('dup'), { cause: { code: '23505' } });
    await expect(service.create({ name: 'a' })).rejects.toMatchObject({ status: 400, message: '标签名称已存在' });
    dbMock.state.insertError = new Error('boom');
    await expect(service.create({ name: 'a' })).rejects.toThrow('boom');
  });

  it('update：无钩子时不额外取行，直接按 id + 范围更新；无匹配行抛 404', async () => {
    const service = makeService();
    dbMock.state.updateRows = [{ id: 1, tenantId: null, name: 'b', remark: null }];
    expect(await service.update(1, { name: 'b' })).toEqual({ id: 1, name: 'b', remark: null });
    expect(dbMock.calls.map((c) => c.kind)).toEqual(['update']);
    expect(dbMock.calls[0].set).toEqual({ name: 'b' });
    expect(render(dbMock.calls[0].where)?.sql).toBe('"tags"."id" = $1');

    dbMock.state.updateRows = [];
    await expect(service.update(2, { name: 'x' })).rejects.toBeInstanceOf(HTTPException);
  });

  it('update：声明 before / toRow 时先取现有行，toRow 可读旧值', async () => {
    const service = makeService({
      update: {
        before: async (_input, existing) => { if (existing.name === 'locked') throw new HTTPException(400, { message: '锁定' }); },
        toRow: (input, existing) => ({ name: `${existing.name}->${input.name ?? ''}` }),
      },
    });
    dbMock.state.selectRows = [{ id: 1, tenantId: null, name: 'old', remark: null }];
    dbMock.state.updateRows = [{ id: 1, tenantId: null, name: 'old->new', remark: null }];
    expect(await service.update(1, { name: 'new' })).toMatchObject({ name: 'old->new' });
    expect(dbMock.calls.map((c) => c.kind)).toEqual(['select', 'update']);
    expect(dbMock.calls[1].set).toEqual({ name: 'old->new' });

    dbMock.state.selectRows = [{ id: 1, tenantId: null, name: 'locked', remark: null }];
    await expect(service.update(1, { name: 'x' })).rejects.toMatchObject({ message: '锁定' });
  });

  it('remove：无钩子直接删并断言存在；removeMany 返回实际删除数并套范围', async () => {
    tenantMock.scope = sql`t = 1`;
    const service = makeService({ tenant: true });
    dbMock.state.deleteRows = [{ id: 1 }];
    await service.remove(1);
    expect(dbMock.calls.map((c) => c.kind)).toEqual(['delete']);
    expect(render(dbMock.calls[0].where)?.sql).toBe('("tags"."id" = $1 and t = 1)');

    dbMock.state.deleteRows = [];
    await expect(service.remove(2)).rejects.toMatchObject({ status: 404 });

    dbMock.calls.length = 0;
    dbMock.state.deleteRows = [{ id: 1 }, { id: 3 }];
    expect(await service.removeMany([1, 2, 3])).toBe(2);
    expect(render(dbMock.calls[0].where)?.sql).toBe('("tags"."id" in ($1, $2, $3) and t = 1)');
    expect(await service.removeMany([])).toBe(0);
  });

  it('remove 钩子：before 收到现有行并可阻止删除；removeMany 对每行调用', async () => {
    const seen: number[] = [];
    const service = makeService({
      remove: {
        before: async (row) => { if (row.name === 'system') throw new HTTPException(400, { message: '内置标签不可删除' }); },
        after: async (row) => { seen.push(row.id); },
      },
    });
    dbMock.state.selectRows = [{ id: 1, tenantId: null, name: 'system', remark: null }];
    await expect(service.remove(1)).rejects.toMatchObject({ message: '内置标签不可删除' });

    dbMock.state.selectRows = [{ id: 2, tenantId: null, name: 'a', remark: null }, { id: 3, tenantId: null, name: 'b', remark: null }];
    dbMock.state.deleteRows = dbMock.state.selectRows;
    expect(await service.removeMany([2, 3])).toBe(2);
    expect(seen).toEqual([2, 3]);
  });
});
