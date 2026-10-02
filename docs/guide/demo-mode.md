# Demo 演示模式（MSW Mock）

Demo 模式使用 MSW 在浏览器中拦截 API 请求并返回 Mock 数据，可在没有后端、数据库、Redis 的环境中演示后台、会员前台与移动审批的主要交互。

## 工作原理

```text
前端请求 fetch / XHR
    ↓
VITE_DEMO_MODE=true 时 enableMocking()
    ↓
mockServiceWorker.js 拦截请求
    ↓
packages/web/src/mocks/handlers 匹配路径
    ↓
返回与真实 API 同形状的响应
```

前端请求适配层不需要为 Demo 写分支；差异集中在 `packages/web/src/mocks/`。

## 本地启动

```bash
npm run dev:demo
```

该脚本等价于 `npm run dev:demo -w @arcbase/web`，底层执行 `vite --mode demo`，读取 `packages/web/.env.demo`。

默认登录账号：`admin` / `123456`。

## 构建 Demo 站

```bash
npm run build:demo
```

根脚本先构建 `@arcbase/shared`，再执行 `@arcbase/web` 的 `build:demo`（`tsc -b && vite build --mode demo`）。产物输出到 `packages/web/dist/`。

GitHub Pages 工作流会在构建文档后执行 Demo 构建，并把 `packages/web/dist` 复制到 `docs/.vitepress/dist/demo`。

线上地址：`https://iwangbowen.github.io/zenith-admin/demo/`。

## 目录结构

```text
packages/web/src/mocks/
├── data/               # Mock 初始数据，按业务模块拆分，尽量从 shared seed 派生
├── handlers/           # MSW handlers，按业务模块拆分
├── utils/              # 响应信封、分页、自增 ID、日期工具
├── browser.ts          # setupWorker
├── index.ts            # enableMocking()，由 VITE_DEMO_MODE 控制
└── *.test.ts           # handler 回归测试
```

当前 Mock 覆盖系统管理、通知、Chat、AI、工作流、规则中心、会员、支付、公众号、CMS、开放平台、知识中心、运维、报表、Demo 业务等模块。具体清单以 `data/` 与 `handlers/` 目录为准。

## 维护规范

1. 有初始数据时先在 `packages/shared/src/seed/{domain}.ts` 定义 seed。
2. 真实数据库种子在 `packages/server/src/db/seed.ts` 写入。
3. `packages/web/src/mocks/data/` 从共享 seed 派生 Demo 数据。
4. `packages/web/src/mocks/handlers/` 实现接口模拟。
5. 在 `handlers/index.ts` 注册 handler，在 `data/index.ts` 汇总导出。
6. 真实 API 的请求 / 响应结构变化时，同步更新对应 handler。

## 公共工具

| 函数 | 说明 |
| --- | --- |
| `ok(data?, message?, init?)` | 成功响应，省略 `data` 时响应体不含 `data` 字段 |
| `fail(code, message, init?)` | 自定义业务失败 |
| `badRequest` / `unauthorized` / `forbidden` / `notFound` / `conflict` / `locked` | 常用失败响应 |
| `pageParams(url, defaultPageSize?)` | 解析分页参数 |
| `paginate(list, url, defaultPageSize?)` | 对数组分页并返回统一分页结构 |
| `pageResult(list, page, pageSize)` | 页码来自 query 之外时使用 |
| `nextIdFrom(list)` | 从现有列表推导下一个自增 ID |

日期时间使用 `packages/web/src/mocks/utils/date.ts` 中的 `mockDateTime()` / `mockDate()`。

## 与真实环境的边界

- Demo 不访问真实数据库、Redis、对象存储、短信、邮件、支付渠道或 AI 服务商。
- 文件上传、终端、WebRTC、外部 OAuth / Webhook 等依赖外部系统的能力以模拟数据或降级提示展示。
- Demo 适合产品演示与前端交互验证，不替代后端集成测试。
