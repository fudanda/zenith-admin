# MSW Mock 实现参考（Step 11）

Demo 演示模式（`VITE_DEMO_MODE=true`）下，MSW 拦截所有 API 请求并返回内存中的静态数据。
**仅在 Step 0 确认需要 Demo 模式时才实现这部分。**

约束条目见 [constraints.md → MSW Mock 层](./constraints.md#msw-mock-层step-11)。

```text
packages/web/src/mocks/
├── utils/
│   ├── array.ts             # 内存数组的共享原地变更工具
│   ├── contract.ts          # mock(op, resolver)：契约绑定的 handler 构造
│   ├── handlers.ts          # 失败响应构造与分页工具（直接用，勿另起炉灶）
│   └── date.ts              # mockDateTime() 等时间工具
├── data/
│   └── xxxs.ts              # 静态初始数据 + nextId 工具函数
├── handlers/
│   └── xxxs.ts              # 契约 handler 定义
└── handlers/index.ts        # 注册 xxxsHandlers（追加即可）
```

---

## 共享工具

`mock(op, resolver)`（`mocks/utils/contract.ts`）给 resolver 的上下文：

| 字段 | 含义 |
| --- | --- |
| `params` / `query` / `headers` / `body` | 已按契约 schema 解析（含 coerce 与默认值，类型即 schema 输出，带 `.default()` 的字段不再可选）；multipart 的 `body` 为 `FormData`；无 JSON 头的请求按 `{}` 进入校验（与服务端一致） |
| `ok(data, message?, init?)` | 成功响应，`data` 必须满足契约响应类型；`message` 默认 `'ok'`，需要 `data: null` 就显式传 `null` |
| `paginate(list)` | 按 `query.page` / `query.pageSize` 切片成 `{ list, total, page, pageSize }` |
| `request` / `url` | 原始请求与 URL（极少需要） |

失败响应与 ID 工具（`mocks/utils/handlers.ts`）：

| 构造函数 | 用途 |
| --- | --- |
| `badRequest` / `unauthorized` / `forbidden` / `notFound` / `conflict` / `locked` | 400 / 401 / 403 / 404 / 409 / 423，`data` 固定 `null` |
| `fail(code, message, init?)` | 上述之外的业务 code |
| `pageResult(list, page, pageSize)` | 页码来自 query 之外时用这个 |
| `nextIdFrom(list)` | 由现有列表推下一个自增 ID，空列表返回 1 |

按任意谓词级联清理内存数组时用 `mocks/utils/array.ts` 的 `removeWhere(list, predicate)`，
它保持原数组引用并返回实际移除数量。

列表与 CRUD 的机械部分用 `mocks/utils/` 的工具，不要在 handler 里手写：

| 工具 | 用途 |
| --- | --- |
| `filterByKeyword(list, keyword, [selectors])`（`filter.ts`） | 关键词对多个字段做 `includes` 过滤；默认大小写敏感，需要时传 `{ caseInsensitive: true }` |
| `matchesFilter(actual, expected)`（`filter.ts`） | 枚举 / ID / 布尔精确筛选：`expected` 为 `undefined` / `null` / 空串不过滤，否则严格相等；`false` / `0` 是有效筛选值。手写 `!query.x || item.x === query.x` 已被 ESLint 封禁 |
| `requireItem(list, id, message)`（`crud.ts`） | 按 id 取记录，找不到抛出 `MockHttpError`，`mock()` 把它映射为 `notFound(message)` 响应 |
| `updateItem(list, id, patch, { notFoundMessage, now })` | 取记录并 `Object.assign` 补丁，`now` 存在时写入 `updatedAt` |
| `removeByIds(list, ids)` | 按 id 集合就地删除，返回删除数量 |
| `readFormOrJsonBody(request)`（`body.ts`） | 同一端点既收 `application/x-www-form-urlencoded` 又收 JSON（OAuth2 令牌类接口） |
| `resolveIdempotent({ request, cache, run })`（`idempotency.ts`） | 按 `Idempotency-Key` 请求头缓存并回放结果 |

所有构造函数的末位参数是原样透传的 `ResponseInit`：默认只在响应体里写 `code`（HTTP 仍是 200），
需要同时设置 HTTP 状态码时显式写 `notFound('XXX 不存在', { status: 404 })`。

---

## 11a：`mocks/data/xxxs.ts`

```ts
import { SEED_XXXS } from '@arcbase/shared/seed';   // 与 DB seed 同一份数据源
import type { Xxx } from '@arcbase/shared/{业务域}';
import { mockDateTime } from '@/mocks/utils/date';
import { nextIdFrom } from '@/mocks/utils/handlers';

// Xxx 类型有 mock 专属字段（如运行时计数）时在此扩展
export interface MockXxx extends Xxx {
  // extraField?: number;
}

const now = mockDateTime();
export const mockXxxs: MockXxx[] = SEED_XXXS.map((x) => ({
  ...x,
  // extraField: 0,
  createdAt: now,
  updatedAt: now,
}));

let nextXxxId = nextIdFrom(mockXxxs);
export function getNextXxxId(): number {
  return nextXxxId++;
}
```

新增模块时**先**在 `shared/src/seed/{业务域}.ts` 添加 `SEED_XXXS`（见 [seed-config.md](./seed-config.md)），
**再**在 mock data 中导入。demo 模式需要额外字段时用 `.map()` 展开后追加，不要整体复制一份静态数组。

## 11b：`mocks/handlers/xxxs.ts`

标准操作由契约派生：`mockResource(xxxContract, options)`（`mocks/utils/resource.ts`）按契约上存在的
list / detail / create / update / remove / removeBatch 生成内存 CRUD——列表筛选由契约 query 的 `x-filter` 语义驱动
（keyword 按 `keyword` 声明的字段模糊匹配、enum / bool / id 与行上同名字段精确匹配、成对时间端点按 `dateField` 闭区间），
`DELETE /batch` 自动先于 `/{id}`；自定义操作用 `mock(op, resolver)` 与派生结果拼在同一数组。

```ts
import { xxxContract, type Xxx } from '@arcbase/shared/{业务域}';
import { mock } from '@/mocks/utils/contract';
import { mockResource } from '@/mocks/utils/resource';
import { mockXxxs } from '../data/xxxs';

export const xxxsHandlers = [
  // ─── 契约声明 all 时：静态 /all 必须先于派生的 detail（/{id}），所以放在 ...mockResource(...) 之前 ──
  mock(xxxContract.all, ({ ok }) =>
    ok(mockXxxs.filter((x) => x.status === 'enabled').map(({ id, name, status }) => ({ id, name, status })))),

  ...mockResource(xxxContract, {
    store: mockXxxs,
    notFound: 'XXX 不存在',
    keyword: (x) => [x.name, x.description],          // 契约 keywordQuery 匹配的行字段；缺省匹配 name
    unique: { field: 'name', message: '名称已存在' },   // 创建 / 更新时重复即 400
    // match: { ownerId: (x) => x.owner.id },          // 筛选键与行字段不同名时的取值
    // dateField: (x) => x.publishedAt,                // 时间范围作用的字段；缺省 createdAt
    // sort: (a, b) => b.id - a.id,
    // 请求体 → 新行；缺省 { id, ...body, createdAt: now, updatedAt: now }，实体字段与 body 不同形时给出
    create: (body, id, now): Xxx => ({ id, name: body.name, description: body.description ?? null, status: body.status, createdAt: now, updatedAt: now }),
    // update: (item, body, now) => { … },              // 缺省 Object.assign(item, body, { updatedAt: now })
    // beforeRemove: (x) => (x.isBuiltin ? '内置 XXX 不可删除' : undefined),
    // messages: { removeBatch: (count) => `已删除 ${count} 条记录` },
    // exclude: ['update'],                             // 写法与真实后端不同的操作：排除后显式 mock(op)
  }),
];
```

- 派生 handler 与真实后端同源：`params` / `query` / `body` 按契约 schema 解析（非法输入同样 400），
  `ok(data)` 的载荷按契约响应类型检查。
- 显式 handler（自定义操作 / `exclude` 的标准操作）沿用 `mock(op, ({ params, query, body, ok, paginate }) => …)`，
  机械 CRUD 用 `mocks/utils/crud.ts` 的 `requireItem` / `updateItem` / `removeItem` / `removeByIds`，
  筛选用 `mocks/utils/filter.ts` 的 `filterByKeyword` / `matchesFilter` / `withinDateRange`。
- 静态路径（`/all` 等自定义 GET）的 handler 必须排在派生的 `detail`（`/{id}`）之前：放在 `...mockResource(...)` **之前**。

上传类操作（`multipart(...)`）的 `body` 是原始 `FormData`；非 JSON 响应（`kind: 'excel'` 等）的 handler 直接返回
`new HttpResponse(blob, { headers })`。

## 11c：`mocks/handlers/index.ts`

在现有文件中**追加**注册（不要替换）：

```ts
import { xxxsHandlers } from './xxxs';

export const handlers = [
  ...authHandlers,
  ...usersHandlers,
  // ... 其他已有 handlers ...
  ...xxxsHandlers,   // ← 新增这行
];
```

---

## 注意事项

- **数据放内存**：mock 数据在页面刷新后会重置，这是预期行为
- **共享引用**：`push` / `splice` 直接修改数组，所有 handler 共享同一份数据，无需额外状态管理
- **时间字段**：创建 / 更新用 `mockDateTime()`，初始数据用 `SEED_DATE`，与 API 的
  `YYYY-MM-DD HH:mm:ss` 契约一致
- **异步任务类型**：新增业务任务类型时还需改 `mocks/handlers/async-tasks.ts`，
  见 [async-tasks.md](./async-tasks.md)
