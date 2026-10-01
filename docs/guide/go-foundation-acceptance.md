# 单组织 Go 基础版交付验收

## SQLite 适配增补验收（2026-10-01）

在 `8cf535ea9` 基础上新增 SQLite 可选存储；PostgreSQL 默认配置、管理员与数据保留。以下为本地实测结果，远程 CI 状态以 GitHub 对应提交为准。

- 原管理台通过真实 SQLite 与 PostgreSQL 验收：管理员和受限用户登录、组织/授权/字典/设置/安全、文件与分片、个人中心、日志、同步 XLSX 导入预检及 CSV/XLSX 导出、窄屏、主题和 CSRF。
- 两种数据库共用 API、Ent 与业务实现。SQLite 使用临时独立文件运行权限、动态组、会话即时失效、配置冲突、文件访问、导入导出和数据库故障回归。
- SQLite 专项验证：空库及重复迁移/seed、多个连接的外键、唯一约束、事务回滚、并发迁移、20 次并发登录失败无丢失、UTC/UTC+8 时间比较、维护清理、WAL 快照及恢复、拒绝未知结构和新版本。
- Windows 实际发布二进制验证 `migrate` / `seed` 重复执行、随机密码 `init-admin`、`backup-sqlite`、两次独立 `serve` 进程就绪和快照恢复。
- 完整原页面构建、类型检查、`go vet -tags integration ./...` 通过；lint 0 错误。新增 SQLite CI 验收同时执行外部 CLI 和 Go 内嵌原管理台。
- 修复 GitHub 浏览器验收中导入菜单关闭动画与下一次打开的竞争，等待菜单隐藏后再点击；没有修改页面布局或业务交互。

本机部署选择继续使用现有 PostgreSQL。新增 SQLite 是独立安装选项，连接切换不搬迁 PostgreSQL 数据。

## PostgreSQL 基线验收

验收日期：2026-10-01。基线：`codex/go-foundation` 的 `839e59f61`，加本次验收发现问题后的修复。以下结果对应包含这些修复的代码，不能解释为原始提交未经修改就全部通过。

验收从独立 Git 克隆开始，没有复制原工作树的 `.env.go`、`node_modules`、前端构建结果或 Go 二进制。运行依赖通过 `npm ci` 和 Go 模块获取；npm/Go 下载缓存允许复用。测试 PostgreSQL 使用专用 `postgres:17.6` 容器，临时管理员、数据库和文件目录与现有业务环境隔离。现有管理员和业务数据没有用于写入验收。

## 验收结果

| 项目 | 实测内容 | 结果 |
| --- | --- | --- |
| 干净安装 | `npm ci`、契约/页面漂移检查、完整 TypeScript 编译、原页面构建、Go 内嵌二进制 | 通过，修复 Windows CRLF 误报后重跑 |
| 空库启动 | 发布二进制执行 `migrate`、`seed`、交互等价 stdin 初始化随机密码管理员；迁移和 seed 各重复两次 | 通过，无固定默认密码 |
| 原管理员页面 | 首页；部门、岗位、用户、菜单、角色、手工/动态用户组、字典；设置、安全、文件、会话、登录/操作日志、个人中心 | Chromium 实测通过 |
| 原页面操作 | 新增/编辑/删除、成员与授权、列表刷新、XLSX 模板/预检/导入、CSV/XLSX 导出、文件上传/分片/预览/下载/批量删除、资料与头像 | 通过，全部连接真实 Go API 和 PostgreSQL |
| 普通账号 | 原登录页验证码登录、自己范围的用户列表和编辑；无权菜单和创建按钮隐藏；越范围详情/修改、提权与文件查询拒绝 | 通过，列表仅返回本人 |
| 权限失效 | 角色停用后原会话立即 403；强制下线后立即 401，刷新回登录页 | 通过 |
| HTTPS | TLS 反向代理保留 Host；原浏览器保存 HttpOnly + Secure + SameSite=Lax Cookie；CSRF 拒绝；不存 localStorage Token | 通过 |
| 独立运行/重启 | 外部 Go 发布进程携带原页面；杀死进程并启动后，原 HTTPS 会话、偏好和私有文件恢复 | 通过 |
| 数据库和文件恢复 | 停止写入后 `pg_dump -Fc`，备份文件目录；源数据修改后向另一个空库 `pg_restore`，恢复文件到原路径 | 通过，恢复备份前数据、会话、深色偏好；3 个文件 SHA256 完全一致 |
| 实际数据库故障 | 短暂停止专用 PostgreSQL；健康、就绪、会话、验证码和密码登录返回 503；重启 PostgreSQL 后原会话恢复 | 通过，认证未绕过 |
| 优雅停机 | 关闭监听、拒绝新请求、等待现有 HTTP 请求完成，再停模块/维护任务并关闭池；重复 Shutdown | 通过 |
| Linux 产物 | Linux amd64 二进制在独立容器作为 PID 1 运行；容器没有 Node 或 Redis 程序；迁移、seed、静态和深链接可用 | 通过，SIGTERM 停机退出码 0 |
| 路由边界 | `/dash/`、`/dash/system/users`、Monaco 资源和健康/就绪为 200；缺失 `.js`、未知 API、租户 API、旧 `/api` 为 404 | 通过 |
| 页面隔离 | 浏览器所有业务请求使用 `/api/v1`；禁止外部资源加载后页面和文本预览正常，未迁移卡片/能力不挂载 | 通过 |

浏览器截图覆盖原首页、受限账号用户页及 390×844 个人中心；另验证主题持久化、页面标签与刷新导航。验收使用临时自签 TLS 证书，Go/Node 单独信任证书，Chromium 仅在测试上下文接受它；没有修改操作系统证书信任。实际生产域名、正式证书和外部服务器部署不属于这次本地验收结果。

## 修复内容

1. 两个生成器的漂移检查统一比较 LF，避免 Windows Git CRLF 检出被误报为契约过期；语义变化仍会失败。
2. Go 的当前用户菜单响应为已授予的按钮补齐导航祖先。API 权限仍只由真实授权产生；回归测试刻意给导航祖先设置额外权限，验证不会隐式授予，也不会开放同级角色页面。
3. 原用户页的角色/部门/岗位下拉只在持有对应查询权限时请求，缺权限时禁止修改这些下拉；未扩大服务端查询或赋权范围。403/404 判别使用已开放页面清单，普通账号不再请求管理员完整菜单接口。

原 React Router、Semi UI、布局、表格、编辑弹窗和权限组件保留。新增内容是验收脚本、权限回归和部署测试。

## 自动验证

- 完整构建与 TypeScript：通过。
- Shared：90 个文件、555 项测试通过。
- 首版 Web：6 个文件、49 项测试通过。
- Go：22 项通过，包含真实 PostgreSQL 回归和 Vite 原页面浏览器；可选发布验收另单独执行并通过。
- `TestReleaseHTTPSBackupRecovery`：独立 HTTPS 发布验收通过，约 67 秒。
- `go vet -tags integration ./...`：通过。
- lint：0 错误、106 个现有警告。
- Git 空白检查：通过。

发布验收已加入 Go foundation CI，使用 CI 专用 PostgreSQL 容器。这里只确认本地执行结果，远程 CI 结果需以推送后运行记录为准。

## 复验和证据

安装、升级、生产配置和复验参数见 [Go 基础版部署说明](./go-foundation.md)。独立发布测试入口为 `backend/deployment_integration_test.go`；原页面入口为 `packages/web/scripts/foundation-smoke.mjs`。发布测试必须使用专用数据库容器，因为故障验收会短暂停机。

本次独立验收检出保存 `acceptance-install.log`、`acceptance-build.log`、`acceptance-go-final.log`、`acceptance-release.log`、`acceptance-shared.log`、`acceptance-web.log`、`acceptance-lint.log` 和 `acceptance-vet.log`。截图、数据库快照与文件快照位于其忽略提交的 `backend/backups/acceptance-20261001/`。快照含会话状态，不进入 Git 或发布包。

临时业务库/恢复库由测试清理，专用数据库和 Linux 验收容器完成后关闭删除；既有项目数据库容器保留。交付包只包含 Go 二进制、生产环境示例、迁移、部署说明和本验收记录。
