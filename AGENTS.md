# Zenith Admin — 项目架构导航

当前默认交付是单组织管理后台：**GoFr + Ent** 后端，支持 **PostgreSQL / SQLite**；`packages/web` 原 React Router / Semi UI 管理台。生产由 Go 二进制携带静态资源和迁移，依赖所选数据库、本地暂存目录与本地或 S3 文件存储。npm workspaces 用于开发、shared 契约和前端构建。

本文件只维护稳定的架构事实、依赖方向和文档入口。参数、字段、模板和验收步骤见专门文档。

开始代码改动前，阅读 [全局/后端约束](.agents/skills/zenith/references/constraints.md) 和 [前端约束](.agents/skills/zenith/references/constraints-frontend.md)，模块修改按 [Zenith Skill](.agents/skills/zenith/SKILL.md) 执行。规范中 Hono/Drizzle、多租户、Worker 和任务中心条款属于历史链路；当前用户确认的单组织 Go 计划优先，不能重新引入已退出的基础设施或业务。

## 系统边界

```text
原管理台页面 / Feature
  → 域 Query Hooks → shared Contract Query → Cookie/CSRF Request Adapter
  → /api/v1 → GoFr Router / 协议与授权适配
  → Go 领域规则 / 显式事务 → Ent → PostgreSQL 或 SQLite / 本地文件
```

- Web 是交互边界，保留原页面、主题、布局、弹窗、表格、权限抽屉和 React Router，不访问数据库或磁盘。
- Go 是业务权威边界，负责认证、授权、校验、数据范围、事务、审计和文件访问控制。服务逻辑使用标准 Context 和显式业务身份，不依赖 GoFr Context。
- shared 是契约边界，维护 Zod schema、操作、枚举、校验、首版页面及设置清单；生成 OpenAPI、Go DTO、权限与审计元数据。生成类型不能代替运行时验证。
- 所选 PostgreSQL 或 SQLite 是主数据源，同时保存会话摘要、登录防护、配置版本和文件元数据；本地文件接口保存字节。切换连接不搬迁数据。
- 没有租户、套餐、租户视角、Redis、独立 Worker 或生产 Node 后端。未迁移业务保留源码，入口和其后台请求不挂载。

## 目录职责与依赖

| 目录 | 职责 |
| --- | --- |
| `backend/` | GoFr 路由与适配、认证授权、组织/账号/配置/文件/审计规则、模块生命周期、CLI |
| `backend/cli/` | 可由独立宿主复用的运维命令；管理员恢复、配置检查与统一备份恢复 |
| `backend/internal/app/` | 模块依赖排序、初始化/关闭、可停止的维护任务调度 |
| `backend/internal/transport/http/` | GoFr 路由、契约校验、响应及流式文件协议；不访问数据库 |
| `backend/internal/data/` | 唯一业务连接池、显式 Ent 事务、版本迁移和 SQLite 备份 |
| `backend/internal/modules/` | 认证、组织、授权、用户组、配置、文件、审计、关联、导入导出、系统、集成及初始化领域；各 HTTP 模块独立注册契约操作 |
| `backend/internal/kernel/` | 无连接池和网络 I/O 的共享业务值、命令参数、结果、错误及审计元数据 |
| `backend/internal/security/`、`backend/internal/storage/` | 业务身份、本地字节边界、S3 适配与凭据加密 |
| `backend/ent/` | Ent 固定系统模型和生成持久化代码 |
| `backend/migrations/` | 不可变版本 SQL；运行时不自动变更结构 |
| `backend/internal/contracts/` | shared 生成的 OpenAPI、Go DTO、操作/权限/审计及策略定义 |
| `backend/internal/dashboard/` | Go 内嵌原管理台静态资源 |
| `packages/web/` | 原 React 应用、页面、域 hooks、请求适配；首版前端继续放这里 |
| `packages/client/` | 独立 TypeScript API 客户端、契约调用、Cookie/CSRF、错误及文件传输；不依赖 UI 或查询缓存 |
| `packages/elements/` | 可组合的会话、登录、权限、头像与上传组件，复用 Client 或宿主会话；不依赖 Web 和全局存储 |
| `packages/admin/` | 导出 `ZenithAdmin` 的独立管理台包、ESM/类型/样式和宿主示例；复用 Web 中的原页面与装配 |
| `packages/create-zenith/` | 独立项目和业务模块生成器；交付已校验的包及 Go SDK 源码版本，不参与生产运行 |
| `packages/shared/` | 领域契约、纯校验、常量、首版能力清单和种子 |
| `packages/server/` | 保留的历史 Hono API、Drizzle、CMS、Worker 与外部集成，退出默认链路 |
| `packages/analytics-sdk/`、`packages/electron/` | 保留的采集 SDK 和桌面容器源码，退出首版构建 |
| `docs/` | 开发、产品、部署及历史架构文档 |

依赖单向：shared 不依赖 Client、Elements、Web、Admin、Go 或历史 Server；Client 只依赖 shared，Elements 依赖 Client/shared 和 Semi UI，Web 通过 Client 调用 Go并复用 Elements，Admin 复用 Web 的管理台入口；Web 不反向依赖 Admin。Web/Go 通过 shared 契约和生成物协作，不导入彼此实现。Web 不依赖 Server 源码。历史业务不接入基础版运行时。

## 后端与部署

`New` 装配已声明的模块并检查依赖、循环和重复路由；初始化失败逆序关闭。`Handler` 支持宿主挂载，`Run` 独立监听，`Shutdown` 停止接入与维护任务并关闭资源。数据层持有一个所选数据库连接池，事务显式传递。SQLite 强制 WAL、外键、等待锁及即时写事务。

认证使用 HttpOnly Cookie 服务端会话、生产 Secure/SameSite 和写请求 CSRF。登录校验来源，每次请求读取会话及授权；停用、改密和下线立即生效。管理员由 `init-admin` 显式创建，没有固定密码。

API 统一 `/api/v1`，管理台 `/dash`。SPA 只回退已开放页面，未知 API 和缺失资源真实 404。健康与就绪检查反映所选数据库状态。迁移显式执行且不可覆盖已发布版本；PostgreSQL 单组织升级预检冲突时失败，保留管理员密码摘要并撤销旧会话。SQLite 使用独立的单组织版本迁移。

## 前端与范围

首版页面由 `packages/shared/src/foundation.ts` 声明，操作与能力由生成目录校验。模块可用性和权限分别判断；生产构建检查页面入口，Query 预取、轮询及 WebSocket 也须遵守能力边界。TanStack Query 管理服务端状态，页面保留原交互状态。

首版保留组织/账号/授权、字典/设置/身份安全、本地文件、会话/日志、真实首页和个人中心。用户组包含手工成员及动态规则。导入导出使用同步真实响应和行级结果，不创建伪造任务。会员、审批、公开/CMS、通知、聊天、工作流、交易、AI、第三方身份和高级运维属于历史源码与后续范围。

## 文档入口

| 内容 | 位置 |
| --- | --- |
| 当前运行、安装、升级、部署和验收 | [docs/guide/go-foundation.md](docs/guide/go-foundation.md) |
| 运维 CLI、独立项目与业务模块模板 | [docs/guide/go-tooling.md](docs/guide/go-tooling.md) |
| API Key、S3、SSE 与只读 MCP | [docs/guide/go-integrations.md](docs/guide/go-integrations.md) |
| Go 包边界、目录重构状态和领域拆分方式 | [docs/guide/go-backend-architecture.md](docs/guide/go-backend-architecture.md) |
| 后端及全局约束 | [.agents/skills/zenith/references/constraints.md](.agents/skills/zenith/references/constraints.md) |
| 前端约束 | [.agents/skills/zenith/references/constraints-frontend.md](.agents/skills/zenith/references/constraints-frontend.md) |
| 模块修改流程 | [.agents/skills/zenith/SKILL.md](.agents/skills/zenith/SKILL.md) |
| 前端数据访问与缓存 | [docs/frontend/data-fetching.md](docs/frontend/data-fetching.md) |
| 独立 API 客户端与使用示例 | [packages/client/README.md](packages/client/README.md) |
| 独立管理台组件、资源部署与宿主示例 | [packages/admin/README.md](packages/admin/README.md) |
| 可组合前端组件与宿主会话适配器 | [packages/elements/README.md](packages/elements/README.md) |
| 历史后端/产品文档 | [docs/backend/](docs/backend/)、[docs/product/](docs/product/) |

## 默认命令

```bash
npm run dev          # Go API + 原 Web 管理台
npm run build        # 契约检查、原管理台构建和 Go 内嵌二进制
npm run check:types  # shared 与 Web
npm run lint         # shared 与 Web
npm test             # 真实 PostgreSQL Go 集成 + shared + 首版 Web
npm run db:generate  # Ent 生成；结构变更另增版本 SQL
npm run db:migrate   # 显式 Go 迁移
npm run db:seed      # 幂等基础初始化
npm run init-admin -- admin
```

历史链路显式使用 `legacy:dev/build/test/lint` 和 `legacy:db:*`。发生偏差时以当前实现、测试和迁移为执行事实，同步修正文档，不在本文件重复维护具体字段和模板。
