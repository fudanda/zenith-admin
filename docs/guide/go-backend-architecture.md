# Go 后端目录与分层

当前后端是单组织模块化单体，使用 GoFr 路由、Ent 和 PostgreSQL / SQLite。领域拆分不更改原管理台、API 路径、Cookie/CSRF、契约生成、数据库表或已发布 SQL。

## 已落实的目录

```text
backend/
├── framework.go             # 对外 New / Handler / Run / Shutdown 与装配
├── store.go                 # 保留 OpenStore 和现有 CLI/嵌入 API
├── cmd/zenith/               # serve / migrate / seed / init-admin / backup-sqlite
├── internal/
│   ├── app/                 # 模块生命周期、维护任务调度
│   ├── transport/http/      # GoFr 路由、契约校验、响应、流式 CSV
│   ├── data/                # 连接池、事务、数据库适配、迁移、备份
│   ├── security/            # 业务身份、显式审计操作人
│   ├── validation/          # 无基础设施依赖的校验工具
│   ├── modules/organization/positions/
│   │   ├── module.go        # 按生成契约声明并注册岗位操作
│   │   ├── handler.go       # HTTP 输入、输出和错误映射
│   │   ├── service.go       # 查询、规则、事务、批量、审计、导出数据
│   │   └── members.go       # 成员可见性与关联写入
│   ├── storage/local/       # os.Root 本地适配，保持路径约束
│   ├── contracts/           # shared 生成的定义与 Go 模型
│   └── dashboard/           # 原管理台静态资源
├── ent/                     # 固定模型和生成代码
├── migrations/              # 原版本 SQL及编译期嵌入
└── examples/embed/
```

## 调用与依赖

```text
HTTP 请求 → 统一认证/授权/契约校验 → 岗位 Handler
          → 岗位 Service（标准 Context、业务身份、操作人）
          → data.Store（唯一连接池、显式 Ent 事务）→ 数据库
```

- Handler 不导入 Ent 或数据层，不查询数据库、不创建事务。
- Service 不依赖 HTTP、GoFr Context、应用装配或前端。可由 CLI、宿主或普通 Go 测试直接调用。
- `Access` 是岗位需要的最小跨域依赖：读取用户数据范围，以及在同一事务内同步动态用户组。装配层提供适配，岗位不会反向导入应用。
- 岗位列表、详情、成员摘要和成员选择使用同一数据范围。替换成员保留操作者无法看到的原关联。
- 写入、关联、用户组同步和必要审计共享事务；任何一步失败全部回滚。部分更新保留省略字段，显式 `null` 清空可空字段。
- 流式 CSV 由协议包输出，服务只提供有界分页数据；XLSX 同步转存继续消费同一岗位导出实现，失败向转换层传播。
- 连接池、SQLite 参数、迁移和备份属于 `data`。SQL 仍在原路径，内容不可改写，`serve` 不自动迁移。
- 字节操作经过 `storage.Provider` / `storage.Root`。本地实现继续使用 `os.Root`；配置可注入实现用于故障验收，默认只有本地存储。

## 模块与进程生命周期

内置岗位是 `organization.positions` 模块，依赖 `foundation-core`。首版未拆分领域由后者明确承接，宿主自定义模块继续通过 `Config.Modules` 注入。装配检查重名、缺失依赖和循环，初始化后核对全部首版操作。初始化失败或契约覆盖失败均逆序关闭已初始化模块，包括部分初始化失败的模块，然后关闭连接池。

维护任务只由 `internal/app` 调度；账号、文件、上传和用户组各自提供任务函数。停机停止接入、等待请求、取消维护任务、逆序关闭模块并关闭数据层。没有新增 Worker 或第二个连接池。

## 当前重构边界

岗位全部操作与基础设施边界已经拆分。账号、部门、角色、菜单、用户组、配置和文件的现有业务实现仍在根包，通过 `foundation-core` 保持真实功能。根包目前仍包含这些过渡实现，还不是只有公开 API 的最终形态。

后续按部门、账号、授权、配置、文件、审计逐域迁移；每次移走完整操作与跨域调用后，从过渡模块删除对应注册。不要建立空目录或把未拆分实现整体搬入 `internal/app`。新领域直接采用模块、Handler、Service 的结构。完成全部拆分后，再收敛根包为公开 API 和配置。

## 验证

`go test ./...` 包含包依赖检查、模块失败清理及不经过 HTTP 的真实 SQLite 岗位服务测试。导入检查禁止 Service 依赖协议层、Handler 访问持久化、基础设施反向依赖业务或装配。带 `integration` 标签的既有验收继续覆盖 PostgreSQL / SQLite、原页面、权限、文件、导入导出与嵌入部署。
