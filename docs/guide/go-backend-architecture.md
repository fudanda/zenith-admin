# Go 后端目录与分层

当前后端是单组织模块化单体，使用 GoFr 路由、Ent 和 PostgreSQL / SQLite。首版领域已全部移出根包，不更改原管理台、API 路径、Cookie/CSRF、契约生成或已发布 SQL；集成扩展通过新版本迁移新增结构。

## 目录职责

```text
backend/
├── framework.go             # 公开 New / Handler / Run / Shutdown
├── services.go              # 领域服务及跨域端口装配
├── modules.go               # 内置模块装配与宿主扩展
├── store.go                 # OpenStore / Seed / InitAdmin 的公开入口
├── cmd/zenith/              # serve / migrate / seed / init-admin / backup-sqlite
├── internal/
│   ├── app/                 # 模块生命周期、维护任务调度
│   ├── transport/http/      # GoFr、Cookie/CSRF、契约校验、解码、响应与流
│   ├── data/                # 唯一连接池、事务、数据库适配、迁移、备份
│   ├── kernel/              # 共享业务值、输入、结果、错误、审计上下文
│   ├── security/            # 业务身份和显式操作人
│   ├── validation/          # 校验工具、日期和文件签名识别
│   ├── modules/
│   │   ├── identity/        # 认证、密码、个人中心、偏好、会话、受限 API Key 及维护
│   │   ├── organization/    # 部门、账号、关联成员及账号批量操作
│   │   │   └── positions/  # 岗位、成员、批量及导出数据源
│   │   ├── authorization/  # 角色、菜单、直接授权、数据范围与有效权限
│   │   ├── usergroups/     # 手工成员、动态规则、同步及角色继承
│   │   ├── configuration/  # 字典、字典项、设置及版本冲突
│   │   ├── files/          # 配置、元数据、授权、上传、下载及维护
│   │   ├── audit/          # 登录/操作日志、筛选、统计及元数据 hooks
│   │   ├── integrations/    # SSE 重查提示、权限过滤的只读 MCP
│   │   ├── relations/      # 受权限约束的关联锚点和分组
│   │   ├── transfers/      # 同步 XLSX 导入、预检和导出转换
│   │   ├── system/         # 首页统计、健康与就绪
│   │   └── bootstrap/      # 幂等种子与显式管理员初始化，无 HTTP 入口
│   ├── storage/            # 本地字节边界、S3 适配、AES-GCM 凭据加密
│   │   ├── local/          # os.Root 路径约束
│   │   └── s3/             # AWS SDK、范围读取及对象删除
│   ├── contracts/          # shared 生成的操作、模型和种子资源
│   └── dashboard/          # 原管理台静态资源
├── ent/                     # 固定模型和生成代码
├── migrations/              # 原版本 SQL及编译期嵌入
└── examples/embed/
```

## 调用与依赖

```text
HTTP → 认证/授权/契约校验 → 领域 Handler → 领域 Service
                                           ↓
                      data.Store → 显式 Ent 事务 → 数据库
                                           ↓
                             storage.Provider / S3 Adapter → 文件字节
```

- Handler 不导入 Ent 或数据层，不查询数据库、不创建事务。它读取请求参数与有界文件流，并把领域结果转换为 JSON、Cookie、CSV、XLSX、ZIP 或支持范围请求的文件响应。
- Service 使用标准 `context.Context`，不导入 HTTP、GoFr、应用装配或前端。业务输入和结果不持有 HTTP Request/ResponseWriter；服务可由 CLI、宿主或普通 Go 测试调用。
- `kernel` 保存跨域共享业务类型、参数、结果、错误和审计上下文，不访问数据库、不执行网络 I/O。生成契约继续由 shared 维护，业务参数验证继续执行。
- 跨域服务不直接导入彼此实现。各域声明实际使用的 `Dependencies` 函数端口，装配层注入。岗位继续使用最小 `Access` 接口。所有服务复用同一 `data.Store`，多步写入和必要审计在同一事务内完成。
- 授权按请求读取。列表、详情、成员摘要、关联选择、批量与导出继续使用原数据范围规则。成员替换保留操作者不可见的现有关联。
- 同步导出读取领域提供的有界 CSV 数据源；XLSX 转换直接消费这些数据，不调用内部 HTTP Handler，不创建任务记录。转换失败返回真实错误，暂存文件在成功发送或失败后关闭并清理。
- 文件服务负责元数据、权限、字节持久化及清理；HTTP 层负责 multipart 和大小限制。返回的文件及 ZIP 源在发送完成后关闭，服务返回时不会提前关闭内容流。
- 连接池、SQLite 参数、版本 SQL和备份属于 `data`。SQL 内容不改写，`serve` 不自动迁移。CLI 初始化通过 `bootstrap` 服务执行，不设置固定管理员密码。

## 模块与进程生命周期

每个 HTTP 领域拥有 `module.go`、`handler.go` 和业务服务，按生成契约注册操作。`foundation-core` 及集中 `registerCore` 已移除。宿主模块继续通过 `Config.Modules` 注入，初始化前检查重名、缺失依赖和循环，初始化后检查全部首版操作的注册覆盖。

生命周期依赖表示初始化先后关系。内置领域初始化只注册路由；跨域业务端口在初始化前已装配，运行时协作不会制造 Go 包循环。岗位声明对组织、授权和用户组模块的依赖。初始化或契约覆盖失败均逆序关闭模块，包括部分初始化失败的模块，然后关闭数据层。

维护任务由 `internal/app` 调度；认证、文件、上传和动态用户组各自提供任务函数。停机停止接入、等待请求、取消维护任务、逆序关闭模块并关闭连接池。生产不需要 Worker 或第二个连接池。

## 验证

`go test ./...` 检查包依赖、模块失败清理、首版契约注册和根包边界，并包含不经过 HTTP 的真实 SQLite 服务测试，覆盖岗位、部门事务与审计回滚、设置版本冲突、密码会话失效及文件/ZIP 流的生命周期。

带 `integration` 标签的验收使用真实 PostgreSQL / SQLite，覆盖原页面、权限、会话、文件、导入导出、嵌入部署、数据库故障及优雅停机。前端页面继续位于 `packages/web`；独立 `packages/client` 负责 API 契约调用及 Cookie/CSRF、JSON、上传和下载传输，Web 保留会话状态、缓存及 UI 提示。使用方式见 [客户端说明](../../packages/client/README.md)。

`packages/admin` 导出 `ZenithAdmin`，复用 Web 的原应用装配，并提供独立 ESM、类型、样式和最小宿主。依赖方向为 `shared → client → elements → web → admin`；原项目通过 Web 内的同一个组件启动，避免包循环。组件拥有专用缓存、Cookie 会话恢复、路径配置和请求/监听的生命周期，不改变 Go 业务边界。资源部署与使用示例见 [管理台包说明](../../packages/admin/README.md)；`TestEmbeddedAdminHost` 从构建后的公开包验证 `/console` 深链接与真实 Go 数据操作。

`packages/elements` 提供可组合的 Provider、登录表单、权限/会话边界、原头像和文件选择/上传组件；不依赖 Web、Router 或全局凭据存储。管理台通过受控会话桥接复用现有 GoAuthProvider，也允许宿主提供 Cookie 会话适配器。`ZenithAdmin` 的品牌、默认主题、语言及外部导航配置都保持原页面与 Go 授权边界，说明见 [组件包](../../packages/elements/README.md)。

集成扩展使用 shared 操作清单声明 API Key 可访问范围。Cookie 写请求继续校验 CSRF，Key 同时受密钥范围与实时账号权限限制。SSE 只发送审计游标与资源重查提示，每次轮询重新校验认证；MCP 使用标准 Streamable HTTP，只注册当前身份可调用的读取工具。S3 失败补偿记录独立于数据库配置，保存原目标与加密凭据，维护任务在重启后继续处理。详见 [集成扩展](./go-integrations.md)。
