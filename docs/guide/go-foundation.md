# Go 基础版迁移状态

当前实现位于 `backend/`、`apps/dash/` 与新增的 `packages/admin-*`、`packages/client`。
原 `packages/server`、`packages/web`、会员端、审批端和 Electron 源码保留。新 `/dash` 构建入口仅引用已迁移页面。

## 已接通的链路

- GoFr HTTP 路由、模块依赖排序与逆序关闭、单一 PostgreSQL 连接池、Ent 固定表、显式 `migrate` 命令。迁移使用仓库内不可变 SQL：空库安装 v4 基线，已有 v3 仅补 `system_settings`，v4 重复执行不改结构；每次迁移在 PostgreSQL 事务与 advisory lock 内完成。
- `/api/v1`：验证码、密码登录、HttpOnly Cookie 会话、CSRF、退出、个人资料、偏好、改密、会话下线、租户视角、租户及套餐、部门、账号、岗位、角色、手工用户组、字典及字典项、文件上传设置、固定首版菜单目录、角色菜单与成员分配、用户直接菜单与数据范围、基础日志和统计。授权按请求读取；账号列表和关联选择执行 Zenith 的数据范围顺序。
- 本地文件存储配置、普通及分片上传、进度查询与中止、列表、统计、公开及私有访问、删除与失败后的维护重试已接通。私有文件只允许同租户上传人或持有文件列表权限者读取；文件内容路径不会暴露磁盘路径。
- `/dash`：React Router + Semi UI 登录、工作台、个人中心、租户、套餐、部门、账号、岗位、角色、手工用户组、字典、文件、文件上传设置及日志页面。Go 二进制嵌入 Vite 构建产物，深链接仅对页面路由回退。
- `go test ./...`、前端 TypeScript 检查、Vite 构建；CI 配有真实 PostgreSQL 集成测试。

## 尚未完成的首版范围

动态规则用户组、菜单编辑、其余系统设置、批量文件操作、导入导出及完整日志字段与筛选仍需迁移。文件上传设置为平台作用域，已支持大小上限、分片阈值、分片大小和基于 Go 内容嗅探的 MIME 白名单；对 Office 等复杂格式的识别与原 Node `file-type` 库可能有差异，需在页面验收中核对。现有页面的全部交互尚未逐项还原；当前角色和组织页面是基础交互版。
契约构建期 OpenAPI/Go DTO 生成及操作清单校验也尚未完成。后续 Ent 模型变更必须新增版本 SQL，不能改写 `backend/migrations/0004_*.sql`；早期 v1/v2 基础库需先使用其对应版本程序升级到 v3。默认 `npm run dev/build/test` 暂保持原链路，避免把未完成的 Go 入口误认为可交付的首版。

## 本地运行已实现部分

需要 Go 1.27、Node 24 和 PostgreSQL 17（专用新库）。先设置 `ZENITH_DATABASE_URL`，例如本地库的 `postgres://.../zenith?sslmode=disable`。随后在 `backend/` 执行：

```text
go run ./cmd/zenith migrate
go run ./cmd/zenith seed
go run ./cmd/zenith init-admin admin
go run ./cmd/zenith serve
```

`init-admin` 在终端安全读取密码，也支持从标准输入读取；不创建默认密码。生产默认给会话 Cookie 加 `Secure`，本地纯 HTTP 调试可显式设置 `ZENITH_INSECURE_COOKIES=true`。
前端开发使用根目录的 `npm run dev:dash`，构建使用 `npm run build:dash`，产物写入 `backend/internal/dash/dist` 并随 Go 编译嵌入。访问 `/dash/`，健康检查为 `/api/v1/health` 与 `/api/v1/ready`。

本地 PostgreSQL 验证：设置 `ZENITH_TEST_DATABASE_URL` 指向独立测试库，在 `backend/` 执行 `go test -tags integration ./...`；CI 默认运行该测试，不用 Mock 替代数据库验收。
