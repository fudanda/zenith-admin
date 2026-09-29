# Go 基础版迁移状态

当前 Go 实现位于 `backend/`。管理后台仍以原 `packages/web` 的页面、布局和主题为唯一界面来源；原 `packages/server`、会员端、审批端和 Electron 源码也保留。此前另建的简化版 `/dash` 页面已撤销，Go 服务现阶段只提供 API，不开放管理台页面。

## 已接通的链路

- GoFr HTTP 路由、模块依赖排序与逆序关闭、单一 PostgreSQL 连接池、Ent 固定表、显式 `migrate` 命令。迁移使用仓库内不可变 SQL：空库安装 v4 基线后升级 v5/v6，已有 v3/v4/v5 依次补齐设置表、菜单字段和动态组规则字段；每次迁移在 PostgreSQL 事务与 advisory lock 内完成。
- `/api/v1`：验证码、密码登录、HttpOnly Cookie 会话、CSRF、退出、个人资料、偏好、改密、会话下线、租户视角、租户及套餐、部门、账号、岗位、角色、手工与动态用户组、字典及字典项、文件上传设置、首版菜单树与平台菜单编辑、角色菜单与成员分配、用户直接菜单与数据范围、基础日志和统计。账号批量启停与删除在同一事务中执行，逐项核对租户和数据范围，停用时撤销会话；套餐支持状态筛选、单条及批量删除，已绑定租户的套餐在事务中拒绝删除；建号时锁定租户行，在同一事务内按租户上限与套餐配额的较小值核查席位。动态组支持规则预览、物化与手动同步；相关账号和组织写入在同一事务中重算，后台定期校准。授权按请求读取；账号列表和关联选择执行 Zenith 的数据范围顺序。登录日志支持用户、结果和日期筛选；基础操作审计支持操作人、资源、动作和日期筛选。两类日志均可按相同条件流式导出 CSV；审计记录在业务事务中自动附带当前租户视角。
- 本地文件存储配置、普通及分片上传、进度查询与中止、列表、统计、公开及私有访问、单条与批量删除、ZIP 流式批量下载及失败后的维护重试已接通。私有文件只允许同租户上传人或持有文件列表权限者读取；文件内容路径不会暴露磁盘路径。
- Go 服务目前不内嵌前端构建产物。原管理后台尚未接入 Cookie 会话和 `/api/v1`，因此不能以原前端成功运行作为本阶段的验收结论。
- `go test ./...`；CI 配有真实 PostgreSQL 集成测试。
- 岗位、菜单、文件批量操作、日志、租户、套餐删除、部门、账号导出与批量操作、角色与字典 CSV 的 26 个已核对操作从 `packages/shared` Zod 契约生成 OpenAPI 3.0.3、Cookie/CSRF 安全描述、权限与审计目录及 Go 模型；Go 路由从生成目录读取方法、路径和权限，CI 检查生成物漂移。岗位、租户、部门、账号、角色、字典和日志列表与流式 CSV 导出分别共用其筛选条件。

## 尚未完成的首版范围

其余系统设置、其他基础页导出与导入、完整日志字段与筛选仍需迁移；Go 首版当前只保存登录事件和基础业务写入审计，尚无旧系统的浏览器、设备、请求体、耗时及统计明细。文件上传设置为平台作用域，已支持大小上限、分片阈值、分片大小和基于 Go 内容嗅探的 MIME 白名单；对 Office 等复杂格式的识别与原 Node `file-type` 库可能有差异，需在页面验收中核对。原 `packages/web` 的登录、请求层、页面数据访问和未迁移功能挂载尚需逐项改为 Go API；页面本身不得另起一套重画。
契约生成目前覆盖岗位、菜单管理、文件批量操作、日志、租户、套餐删除、部门、账号导出与批量操作、角色及字典导出 26 个操作，其余首版操作仍需逐一核对契约、运行时校验和审计后纳入；生成的 OpenAPI 不能当成完整首版接口文档。后续 Ent 模型变更必须新增版本 SQL，不能改写已提交的迁移文件；早期 v1/v2 基础库需先使用其对应版本程序升级到 v3。默认 `npm run dev/build/test` 暂保持原链路，避免把未完成的 Go 入口误认为可交付的首版。

## 本地运行已实现部分

需要 Go 1.27、Node 24 和 PostgreSQL 17（专用新库）。先设置 `ZENITH_DATABASE_URL`，例如本地库的 `postgres://.../zenith?sslmode=disable`。随后在 `backend/` 执行：

```text
go run ./cmd/zenith migrate
go run ./cmd/zenith seed
go run ./cmd/zenith init-admin admin
go run ./cmd/zenith serve
```

`init-admin` 在终端安全读取密码，也支持从标准输入读取；不创建默认密码。生产默认给会话 Cookie 加 `Secure`，本地纯 HTTP 调试可显式设置 `ZENITH_INSECURE_COOKIES=true`。
健康检查为 `/api/v1/health` 与 `/api/v1/ready`。`/dash` 暂返回 404，直到原 `packages/web` 管理后台完成 Go 接线并通过真实浏览器验收。Go 宿主嵌入示例位于 `backend/examples/embed/main.go`，展示将 `Framework.Handler()` 挂到现有 HTTP 服务器并在停机时调用 `Shutdown()`；同样需要先运行迁移和初始化命令。

本地 PostgreSQL 验证：设置 `ZENITH_TEST_DATABASE_URL` 指向独立测试库，在 `backend/` 执行 `go test -tags integration ./...`；CI 默认运行该测试，不用 Mock 替代数据库验收。
核对已纳入的契约生成物：仓库根目录执行 `npm run check:foundation-contracts`；修改 shared 契约后依次执行 `npm run generate:foundation-contracts` 和 `npm run generate:foundation-go-models`，提交 `backend/internal/contracts/` 下的变更。
