import { apiScopeContract } from '@arcbase/shared/open-platform';
import type { ApiScope } from '@arcbase/shared/open-platform';
import { mock } from '@/mocks/utils/contract';
import { badRequest, nextIdFrom } from '@/mocks/utils/handlers';
import { mockApiScopes } from '@/mocks/data/api-scopes';
import { mockDateTime } from '@/mocks/utils/date';
import { filterByKeyword } from '@/mocks/utils/filter';
import { mockResource } from '@/mocks/utils/resource';

const scopes: ApiScope[] = mockApiScopes.map((s) => ({ ...s }));
let nextId = nextIdFrom(scopes);

export const apiScopesHandlers = [
  mock(apiScopeContract.options, ({ ok }) => ok(scopes.filter((s) => s.status === 'enabled'))),

  mock(apiScopeContract.list, ({ query, ok, paginate }) => {
    let filtered = scopes;
    if (query.keyword) filtered = filterByKeyword(filtered, query.keyword, [(s) => s.code, (s) => s.name]);
    if (query.scopeGroup) filtered = filtered.filter((s) => s.scopeGroup === query.scopeGroup);
    if (query.status) filtered = filtered.filter((s) => s.status === query.status);
    return ok(paginate(filtered));
  }),

  mock(apiScopeContract.create, ({ body, ok }) => {
    if (scopes.some((s) => s.code === body.code)) {
      return badRequest('scope 编码已存在', { status: 400 });
    }
    const now = mockDateTime();
    const created: ApiScope = {
      id: nextId++,
      code: body.code,
      name: body.name,
      description: body.description ?? null,
      scopeGroup: body.scopeGroup,
      status: body.status,
      usedByAppCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    scopes.unshift(created);
    return ok(created, '创建成功');
  }),
  ...mockResource(apiScopeContract, {
    store: scopes,
    notFound: 'API Scope 不存在',
    messages: { removeBatch: (count) => `已删除 ${count} 条记录` },
    exclude: ['list', 'create'],
  }),
];
