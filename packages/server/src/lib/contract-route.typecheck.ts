/**
 * 契约路由适配的编译期契约（`npm run typecheck:contracts`，随 lint 执行）。
 *
 * 正例必须通过，反例以 `@ts-expect-error` 锁定：任何让 handler 入参 / 响应类型
 * 失去契约约束的改动都会在这里变红。不参与构建产物，也不在 vitest 中运行。
 */
import * as z from 'zod';
import { defineContract, idParam, op, paginated, paginationQuery } from '@arcbase/shared/core';
import { defineContractRoute } from './contract-route';
import { conflictResponse, okBody } from './openapi-schemas';
import { authMiddleware } from '../middleware/auth';

const itemSchema = z.object({ id: z.int(), name: z.string() });

const probe = defineContract('/api/typecheck-probe', {
  list: op.get('/', {
    query: paginationQuery.extend({ keyword: z.string().optional() }),
    response: paginated(itemSchema),
    summary: '列表',
  }),
  update: op.put('/{id}', { params: idParam, body: z.object({ name: z.string() }), response: itemSchema, summary: '更新' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除' }),
  exportFile: op.get('/export', { kind: 'excel', summary: '导出' }),
});

// ─── 正例 ────────────────────────────────────────────────────────────────────

export const listRoute = defineContractRoute(probe.list, {
  middleware: [authMiddleware],
  handler: async (c) => {
    const query = c.req.valid('query');
    const keyword: string | undefined = query.keyword;
    const page: number = query.page;
    void keyword;
    return c.json(okBody({ list: [{ id: 1, name: 'a' }], total: 1, page, pageSize: query.pageSize }), 200);
  },
});

export const updateRoute = defineContractRoute(probe.update, {
  middleware: [authMiddleware],
  responses: conflictResponse,
  handler: async (c) => {
    const id: number = c.req.valid('param').id;
    const name: string = c.req.valid('json').name;
    return c.json(okBody({ id, name }, '更新成功'), 200);
  },
});

export const removeRoute = defineContractRoute(probe.remove, {
  middleware: [],
  handler: async (c) => {
    c.req.valid('param');
    return c.json(okBody(null, '删除成功'), 200);
  },
});

// ─── 反例 ────────────────────────────────────────────────────────────────────

export const wrongNullData = defineContractRoute(probe.remove, {
  middleware: [],
  // @ts-expect-error 契约响应为 null，不能返回对象
  handler: async (c) => c.json(okBody({ id: 1 }), 200),
});

export const unknownBodyField = defineContractRoute(probe.update, {
  middleware: [],
  handler: async (c) => {
    // @ts-expect-error 契约请求体没有 title 字段
    const title = c.req.valid('json').title;
    void title;
    return c.json(okBody({ id: 1, name: 'x' }), 200);
  },
});

export const missingResponseField = defineContractRoute(probe.list, {
  middleware: [],
  // @ts-expect-error 分页载荷缺少 total
  handler: async (c) => c.json(okBody({ list: [], page: 1, pageSize: 10 }), 200),
});

export const queryOnBodylessRoute = defineContractRoute(probe.remove, {
  middleware: [],
  handler: async (c) => {
    // @ts-expect-error 该操作未声明 query
    c.req.valid('query');
    return c.json(okBody(null), 200);
  },
});
