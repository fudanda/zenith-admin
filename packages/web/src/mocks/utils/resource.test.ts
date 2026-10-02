import { beforeEach, describe, expect, it } from 'vitest';
import * as z from 'zod';
import type { HttpHandler } from 'msw';
import { batchIdsBody, dateRangeQuery, defineContract, entityStatusQuery, entityStatusSchema, idParam, idQuery, keywordQuery, op, paginated, paginationQuery, queryBool } from '@arcbase/shared/core';
import { mock } from './contract';
import { mockResource } from './resource';

const itemSchema = z.object({
  id: z.int(),
  name: z.string(),
  code: z.string(),
  status: entityStatusSchema,
  pinned: z.boolean(),
  groupId: z.int().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
type Item = z.infer<typeof itemSchema>;
const createSchema = z.object({ name: z.string().min(1), code: z.string(), status: entityStatusSchema.default('enabled'), pinned: z.boolean().default(false), groupId: z.int().nullable().optional() });
const itemContract = defineContract('/api/res-items', {
  list: op.get('/', { access: 'authenticated',
    query: paginationQuery.extend({ keyword: keywordQuery('名称 / 编码'), status: entityStatusQuery, pinned: queryBool(), groupId: idQuery(), ...dateRangeQuery('创建时间') }),
    response: paginated(itemSchema), summary: '列表',
  }),
  detail: op.get('/{id}', { access: 'authenticated', params: idParam, response: itemSchema, summary: '详情' }),
  create: op.post('/', { access: 'authenticated', body: createSchema, response: itemSchema, summary: '创建' }),
  update: op.put('/{id}', { access: 'authenticated', params: idParam, body: createSchema.partial(), response: itemSchema, summary: '更新' }),
  removeBatch: op.delete('/batch', { access: 'authenticated', body: batchIdsBody, summary: '批量删除' }),
  remove: op.delete('/{id}', { access: 'authenticated', params: idParam, summary: '删除' }),
  toggle: op.post('/{id}/toggle', { access: 'authenticated', params: idParam, response: itemSchema, summary: '切换' }),
});

const ORIGIN = window.location.origin;
let store: Item[];
let handlers: HttpHandler[];

const seed = (): Item[] => [
  { id: 1, name: '甲', code: 'A', status: 'enabled', pinned: true, groupId: 1, createdAt: '2026-09-01 10:00:00', updatedAt: '2026-09-01 10:00:00' },
  { id: 2, name: '乙', code: 'B', status: 'disabled', pinned: false, groupId: 2, createdAt: '2026-09-05 10:00:00', updatedAt: '2026-09-05 10:00:00' },
  { id: 3, name: '丙', code: 'C', status: 'enabled', pinned: false, groupId: null, createdAt: '2026-09-10 10:00:00', updatedAt: '2026-09-10 10:00:00' },
];

async function call(method: string, path: string, body?: unknown) {
  for (const handler of handlers) {
    const request = new Request(`${ORIGIN}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await (handler as unknown as { run: (args: unknown) => Promise<{ response?: Response } | null> }).run({ request, requestId: `res-${Math.random()}` });
    if (result?.response) return { status: result.response.status, body: await result.response.json() as { code: number; message: string; data: never } };
  }
  return null;
}

beforeEach(() => {
  store = seed();
  handlers = [
    ...mockResource(itemContract, {
      store,
      notFound: '条目不存在',
      keyword: (item) => [item.name, item.code],
      unique: { field: 'code', message: '编码已存在' },
      beforeRemove: (item) => (item.id === 1 ? '内置条目不可删除' : undefined),
      create: (body, id, now) => ({ id, ...body, groupId: body.groupId ?? null, createdAt: now, updatedAt: now }),
    }),
    mock(itemContract.toggle, ({ params, ok }) => {
      const item = store.find((x) => x.id === params.id)!;
      item.status = item.status === 'enabled' ? 'disabled' : 'enabled';
      return ok(item);
    }),
  ];
});

describe('mockResource · 列表筛选由 x-filter 语义驱动', () => {
  it('keyword 按声明字段模糊匹配；enum / bool / id 与同名字段精确匹配；空值不过滤', async () => {
    expect((await call('GET', '/api/res-items'))?.body.data).toMatchObject({ total: 3, page: 1, pageSize: 10 });
    expect((await call('GET', '/api/res-items?keyword=B'))?.body.data).toMatchObject({ total: 1, list: [expect.objectContaining({ id: 2 })] });
    expect((await call('GET', '/api/res-items?status=enabled'))?.body.data).toMatchObject({ total: 2 });
    expect((await call('GET', '/api/res-items?status='))?.body.data).toMatchObject({ total: 3 });
    expect((await call('GET', '/api/res-items?pinned=false'))?.body.data).toMatchObject({ total: 2 });
    expect((await call('GET', '/api/res-items?groupId=1'))?.body.data).toMatchObject({ total: 1 });
    expect((await call('GET', '/api/res-items?status=archived'))?.status).toBe(400);
  });

  it('成对的时间端点按 createdAt 闭区间过滤，止端纯日期补到当天末尾', async () => {
    expect((await call('GET', '/api/res-items?startTime=2026-09-02'))?.body.data).toMatchObject({ total: 2 });
    expect((await call('GET', '/api/res-items?endTime=2026-09-05'))?.body.data).toMatchObject({ total: 2 });
    expect((await call('GET', '/api/res-items?startTime=2026-09-05%2000:00:00&endTime=2026-09-05%2023:59:59'))?.body.data).toMatchObject({ total: 1, list: [expect.objectContaining({ id: 2 })] });
  });
});

describe('mockResource · 标准写操作', () => {
  it('detail 404；create 补 id / 时间并做唯一校验；update 就地合并并刷新 updatedAt', async () => {
    expect((await call('GET', '/api/res-items/9'))?.status).toBe(404);
    expect((await call('POST', '/api/res-items', { name: '丁', code: 'A' }))?.body).toMatchObject({ code: 400, message: '编码已存在' });
    const created = await call('POST', '/api/res-items', { name: '丁', code: 'D' });
    expect(created?.body).toMatchObject({ code: 0, message: '创建成功', data: { id: 4, name: '丁', code: 'D', status: 'enabled', pinned: false, groupId: null } });
    expect(store).toHaveLength(4);

    expect((await call('PUT', '/api/res-items/2', { code: 'A' }))?.body).toMatchObject({ code: 400, message: '编码已存在' });
    const updated = await call('PUT', '/api/res-items/2', { name: '乙2', code: 'B' });
    expect(updated?.body).toMatchObject({ code: 0, message: '更新成功', data: { id: 2, name: '乙2', code: 'B' } });
    expect(store[1].updatedAt).not.toBe('2026-09-05 10:00:00');
  });

  it('remove / removeBatch 先注册 /batch；beforeRemove 阻止删除；自定义操作与派生 handler 共存', async () => {
    expect((await call('DELETE', '/api/res-items/1'))?.body).toMatchObject({ code: 400, message: '内置条目不可删除' });
    expect((await call('DELETE', '/api/res-items/3'))?.body).toMatchObject({ code: 0, message: '删除成功' });
    expect(store.map((x) => x.id)).toEqual([1, 2]);
    expect((await call('DELETE', '/api/res-items/batch', { ids: [2, 99] }))?.body).toMatchObject({ code: 0, message: '批量删除成功' });
    expect(store.map((x) => x.id)).toEqual([1]);
    expect((await call('POST', '/api/res-items/1/toggle'))?.body.data).toMatchObject({ id: 1, status: 'disabled' });
  });

  it('exclude 的操作不派生，交给显式 handler', async () => {
    handlers = mockResource(itemContract, { store, notFound: 'x', exclude: ['create', 'update'] });
    expect(handlers).toHaveLength(4);
    expect(await call('POST', '/api/res-items', { name: 'n', code: 'Z' })).toBeNull();
  });
});
