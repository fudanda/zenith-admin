# 单组织 Go 基础版

管理台继续使用 `packages/web` 中的 Zenith 原页面、React Router 和 Semi UI。默认后端是 `backend/` 中的 GoFr + Ent，主数据及认证状态支持 PostgreSQL 或 SQLite，本地文件目录保存文件字节。生产不需要 Node、Redis 或独立 Worker。原 Hono、会员、审批、Electron 和未迁移业务保留源码，通过显式历史命令使用，不进入基础版构建。

## 菜单与运行边界

| 位置 | 首版能力 |
| --- | --- |
| 首页 | 真实账号、有效会话、登录和操作统计 |
| 系统管理 | 用户、部门、岗位、菜单、角色、用户组、字典及字典项 |
| 系统设置 | 登录验证码、界面策略、个人偏好策略、文件上传设置 |
| 身份安全 | 密码、失败防护、验证码触发和会话策略 |
| 文件管理 | 本地配置、连接测试、普通与分片上传、预览、下载、批量和失败重试 |
| 在线用户 | 查询和强制下线 |
| 审计日志 | 登录日志、操作日志、筛选、详情、统计和导出 |
| 头像菜单 | 个人资料、头像裁剪上传、改密、偏好、设备与个人日志、退出 |

保留原层级、图标和页面路径。`packages/shared/src/foundation.ts` 声明开放页面，`foundation-operations.ts` 是生成后端契约与前端可用性检查共用的操作清单；生成目录收录权限、审计、菜单和设置。构建检查禁止未开放页面入口进入产物，请求适配器拒绝未纳入的操作。通知、聊天、任务、工作流、CMS、AI、第三方登录、MFA、模拟登录和 API Token 不挂载，不启动其预取、轮询或 WebSocket。

Go 和当前 Ent 模型没有租户、套餐、配额或租户视角。历史迁移保留旧结构的快照，仅用于安全升级；运行库升级完成后不存在租户表和业务租户列。租户、套餐和旧 `/api` 路径均返回 404。

## 开发与构建

开发需要 Node 24、`backend/go.mod` 指定的 Go 版本及 PostgreSQL。复制 `.env.go.example` 为忽略提交的 `.env.go`，配置专用业务库和测试库；禁止使用业务库作为测试库。数据库版本必须通过命令显式升级，`serve` 发现版本不匹配直接失败。

```bash
npm ci
npm run db:migrate
npm run db:seed
npm run init-admin -- admin
npm run dev
```

`init-admin` 从终端安全读取密码，没有默认密码。已有管理员无需重复创建。验证码初始开启，自助注册和邮件找回关闭。安全默认值及校验由 shared 导出；密码策略同时作用于初始化、建号、重置和个人改密。

开发管理台默认在 `http://127.0.0.1:5373/dash/`，Vite 代理到 `http://127.0.0.1:8080` 的 Go API。代理保留浏览器 Host，不能使用 `changeOrigin` 绕过登录来源验证。`.env.go` 由根目录命令加载，独立运行二进制时直接设置环境变量。

```bash
npm run build
npm run check:types
npm run lint
npm test
```

默认构建执行契约和页面清单漂移检查、原管理台类型检查及构建、页面隔离检查，复制静态产物后生成 `backend/bin/zenith`（Windows 为 `zenith.exe`）。`npm test` 必须连接真实 PostgreSQL，执行 Go 集成测试、shared 测试和首版 Web 测试；未配置测试库会失败。历史链路使用 `legacy:dev`、`legacy:build`、`legacy:test`、`legacy:lint` 和 `legacy:db:*`。

## 数据库安装与升级

当前版本为 10。新库、基础版 v3 至 v9 均通过不可变 SQL 顺序迁移到该版本；迁移运行于事务和 PostgreSQL advisory lock 中。未标记版本的现有 Zenith/Hono 库不会被覆盖；v1/v2 须先用对应旧版本程序升级到 v3。此工具不迁移原 Hono 数据库。

升级前备份 PostgreSQL 和文件目录。`0007_single_organization.sql` 预检所有业务租户列：存在租户归属数据时失败；全局用户名和业务编码冲突也会使事务回滚，不自动合并或清空。保留原管理员、密码摘要和授权，仅撤销旧会话，升级后重新登录。

`seed` 幂等创建基础菜单、权限及必要配置，并从原 shared seed 补齐状态、菜单类型、菜单显示、性别和部门类别字典；保留已编辑字典项和自定义菜单。不创建固定密码管理员。`db:generate` 重新生成 Ent 代码，结构变更须另增版本 SQL 并审核，不得覆盖已发布迁移。服务启动不执行 DDL。

## 独立生产部署

### 选择数据库

现有 PostgreSQL 配置保持兼容；SQLite 使用 `ZENITH_DATABASE_URL=sqlite:PATH`，如 Windows 的 `sqlite:D:/ai/zenith-admin/storage/zenith.db` 或 Linux 的 `sqlite:/var/lib/zenith/zenith.db`。路径不接受 URI 查询参数或内存数据库。服务自动创建父目录与数据库文件，但表结构仍须显式执行 `migrate`。相对路径以进程工作目录为基准，独立部署建议绝对路径。

SQLite 使用纯 Go 驱动，发布包不需要 C 编译器或另一个数据库服务。连接强制外键、WAL、FULL 同步、10 秒锁等待与即时写事务；时间保存为 UTC 纳秒并恢复为 `time.Time`。业务、权限、Cookie、配置冲突与审计路径共用 Ent。SQLite 面向单机单服务实例；多实例部署继续使用 PostgreSQL。

两个数据库是独立安装，切换 URL 不转换或搬迁数据。已有 PostgreSQL 管理员和业务数据保留在原库。SQLite 从 `migrations/sqlite/0010_baseline.sql` 的单组织基线开始，拒绝未标记版本的其他表及未知版本；不会执行 PostgreSQL 历史多租户迁移。已发布迁移不可改写。

备份 SQLite 使用 `zenith backup-sqlite OUTPUT.db`，以 `VACUUM INTO` 捕获已提交的 WAL 数据，拒绝覆盖已有文件。数据库与文件目录一起备份时先停止应用写入，创建数据库快照，再复制文件目录。不能仅复制运行中的 `.db` 而遗漏 WAL。恢复时停止服务，使用备份数据库的新路径和匹配的文件目录，再启动对应版本。PostgreSQL 继续使用 `pg_dump` / `pg_restore`。

本机 HTTP 验收可显式设置 `ZENITH_INSECURE_COOKIES=true`；正式 HTTPS 配置继续使用 Secure Cookie。

### PostgreSQL 示例

只需发布 Go 二进制、配置 PostgreSQL 和持久化本地文件目录。二进制同时携带 SQL 迁移、生成契约和原管理台资源（包括 Monaco 文本预览运行时），不读取 Node 或 Hono 产物，不通过 CDN 加载文本预览。

```bash
export ZENITH_DATABASE_URL='postgres://USER:PASSWORD@HOST:5432/zenith?sslmode=require'
export ZENITH_ADDR='127.0.0.1:8080'
./zenith migrate
./zenith seed
./zenith init-admin admin  # 仅首次安装
./zenith serve
```

生产通过 HTTPS 访问，不设置 `ZENITH_INSECURE_COOKIES=true`；该开关仅用于本地 HTTP。服务使用 HttpOnly、Secure、SameSite Cookie 和写请求 CSRF，浏览器不保存访问令牌。信任的反向代理应保留 Host 和原始 HTTPS 协议；应用不接受任意外部来源登录。

- 管理台：`/dash/`，React Router basename 为 `/dash`。
- 深链接：如 `/dash/system/users`；只有已开放页面执行 SPA 回退，缺失资源和未知 API 返回真实 404。
- 健康：`/api/v1/health`；就绪：`/api/v1/ready`。数据库故障返回 503。
- API：`/api/v1`，JSON 使用 `{ code, message, data }`。
- 配置文件根目录通过原文件配置页维护，只支持本地存储，不返回磁盘路径。须备份并保留该目录。

`New`、`Handler`、`Run`、`Shutdown` 支持 Go 宿主嵌入，见 `backend/examples/embed/main.go`。宿主也必须显式完成迁移，并在关闭时调用 `Shutdown`。模块检查依赖、循环和重复路由，失败逆序清理；维护任务可停止并重复执行。

## 权限、会话与文件

每个请求从 PostgreSQL 读取账号、会话、直接授权、启用角色及用户组继承，不跨请求缓存授权。部门后代、自定义范围和成员选择使用原数据范围优先级；隐藏菜单不替代 API 授权。普通管理员不能授予本人没有的权限或数据范围，超级管理员角色和账号受到保护。账号停用、改密、密码重置、强制下线使相关会话立即失效。

业务写入和必要审计使用同一 Ent 事务。日志包含操作人、追踪 ID、请求路径、方法、终端、过滤后的请求体和耗时；密码、Cookie、会话秘密不入审计。未采集的地理位置等字段为空，不伪造。

私有文件仅上传人或相应文件权限持有人可访问；公开文件可直接访问。普通及分片上传使用 Cookie/CSRF，保留原进度与取消。失败清理暂存文件；磁盘删除失败保留待删除记录，由重试或维护任务继续处理，不能提前标记成功。个人头像有独立认证接口，不要求文件管理权限，只接受有效 JPEG/PNG、2 MB 内、尺寸不超过 4096。

## 同步导入导出

沿用原按钮、用户 XLSX 模板、预检、重复策略和行级结果，不创建任务或轮询任务中心。用户导入最多 5000 行、压缩文件 10 MB、展开总量 50 MB；每行独立事务，结果明确标记成功、跳过或错误。重置密码仍执行密码策略及会话撤销。CSV/XLSX 导出复用列表筛选和权限；XLSX 使用流式写入，不伪造任务状态。大批量任务属于后续范围。

## 契约与验证

shared Zod 契约生成 OpenAPI 3.0.3、Cookie/CSRF 描述、权限、审计目录及 Go DTO。HTTP 适配层执行请求参数、JSON、权限和 CSRF 校验；DTO 不代替运行时验证。集成测试也校验成功响应契约。

```bash
npm run generate:foundation-contracts
npm run generate:foundation-go-models
npm run generate:foundation-ui
npm run check:foundation-contracts
npm run check:foundation-ui
```

真实浏览器验收使用原页面和隔离的 PostgreSQL schema，自动创建临时管理员，不使用 Mock、不改现有密码。安装 Playwright Chromium，设置 `ZENITH_TEST_DATABASE_URL` 和 `ZENITH_BROWSER_TEST_NODE`（Node 绝对路径），在 `backend/` 执行：

```bash
go test -tags integration -count=1 -v ./...
# 先 npm run build:go:web，再验收 Go 内嵌页面，不启动 Vite：
ZENITH_BROWSER_PRODUCTION=true go test -tags integration -count=1 -run TestOriginalWebFoundation -v .
```

CI 必跑真实 PostgreSQL 集成测试、类型、lint、生成漂移、页面构建、开发及 Go 嵌入两种浏览器验收。覆盖单组织升级拒绝与回滚、并发设置、角色/直接/组继承、数据范围、会话重启和失效、登录防护、CSRF、数据库故障、文件私有访问、分片与清理、同步导入导出及原页面闭环。

CI 同时以 `ZENITH_TEST_DATABASE_URL=sqlite:./data/test.db` 运行真实 SQLite 集成和 Go 内嵌原页面验收。每项测试使用独立临时数据库文件；PostgreSQL 历史迁移测试仅在 PostgreSQL 分组执行。SQLite 基线、拒绝未知结构、各连接外键、唯一约束、事务回滚、并发迁移/登录失败、时区及维护清理、WAL 快照恢复由常规 Go 测试覆盖。`ZENITH_BROWSER_TEST_NODE` 与 `ZENITH_BROWSER_PRODUCTION=true` 的配置与 PostgreSQL 一致。

发布二进制验收使用 `TestReleaseHTTPSBackupRecovery`：从空库执行真实 CLI，通过本地 TLS 反向代理访问原页面，验证管理员和受限用户、Secure Cookie、服务进程重启、数据库与文件快照恢复，以及实际 PostgreSQL 中断后的 503 和恢复。TLS 代理使用临时测试证书，Node 单独信任该证书，Chromium 仅在验收上下文接受它；生产 Cookie 配置始终开启 Secure。此项不替代实际部署域名的证书配置。

该测试会短暂停止 `ZENITH_ACCEPTANCE_PG_CONTAINER`，因此必须使用专用 PostgreSQL 测试容器，用户为 `zenith`，不能指向业务库容器。提供具有建库权限的 `ZENITH_TEST_DATABASE_URL`、已构建的绝对路径 `ZENITH_DEPLOYMENT_BINARY` 和 `ZENITH_BROWSER_TEST_NODE`，然后在 `backend/` 执行：

```bash
go test -tags integration -count=1 -run TestReleaseHTTPSBackupRecovery -v .
```

可选 `ZENITH_ACCEPTANCE_ARTIFACTS` 指定验收日志、截图与快照目录；默认使用测试临时目录。数据库快照包含账号和会话状态，应存入备份目录，不能提交 Git。测试创建的业务库和恢复库均自动清理。`TestGracefulReleaseShutdown` 随普通 PostgreSQL 集成测试执行，验证停止接入、拒绝新请求、等待现有请求完成、关闭模块和维护任务、关闭连接池及重复停机。

当前验收记录见 [首版交付验收](./go-foundation-acceptance.md)。

## 发布包

发布工作流打包 Linux amd64 和 Windows amd64 的 Go 二进制，同时附带生产环境示例、部署说明和版本化迁移。Linux 解压后先执行 `chmod +x ./zenith`，再按独立生产部署步骤设置环境变量。旧 Hono CI、Demo 和 Pages 发布流程改为手动触发，不作为基础版默认交付。

Windows 独立部署示例（将连接串替换为实际环境）：

```powershell
$env:ZENITH_DATABASE_URL='postgres://USER:PASSWORD@HOST:5432/zenith?sslmode=require'
$env:ZENITH_ADDR='127.0.0.1:8080'
.\zenith.exe migrate
.\zenith.exe seed
.\zenith.exe init-admin admin # 仅首次安装，交互输入密码
.\zenith.exe serve
```
