# ArcBase

ArcBase 是单组织管理后台：GoFr + Ent 后端支持 PostgreSQL / SQLite，管理台保留 React Router、Semi UI 和原有页面交互。Go 二进制携带静态资源与版本迁移，生产无需 Node、Redis 或独立 Worker。

基础功能包括账号、部门、岗位、菜单、角色、用户组、字典、设置、身份安全、文件、会话、登录日志、操作审计、首页和个人中心。扩展能力包括 API Key、S3、SSE、只读 MCP、Go 模块生命周期和业务模块生成器。历史 Hono 与未开放业务保留源码，退出默认运行和生产构建。

## 开发与部署

使用 Node.js 24 和 backend/go.mod 指定的 Go 版本。复制 .env.go.example 为 .env.go，配置 ARCBASE_DATABASE_URL；SQLite 可使用 sqlite:./data/arcbase.db，PostgreSQL 使用已有连接。切换连接不会搬迁数据。测试必须使用独立数据库。

~~~bash
npm install
npm run db:migrate
npm run db:seed
npm run init-admin -- admin
npm run dev
~~~

管理员由命令显式创建，无固定默认密码。已有安装保留管理员与数据，无须重复创建。开发页面为 http://127.0.0.1:5373/dash/，API 为 http://127.0.0.1:8080/api/v1。

~~~bash
npm run build
backend/bin/arcbase serve
~~~

Windows 二进制为 backend/bin/arcbase.exe。生产需要所选数据库、本地暂存目录，以及本地或 S3 文件存储。HTTPS 配置与备份恢复见部署指南。

## 可复用包

| 包 | 用途 |
| --- | --- |
| @arcbase/shared | 领域契约、校验与能力清单 |
| @arcbase/client | 独立 Cookie/CSRF API 客户端 |
| @arcbase/elements | 可组合的登录、会话、权限、头像和上传组件 |
| @arcbase/admin | 统一 ArcBaseAdmin 组件及宿主配置 |
| create-arcbase | 独立项目及业务模块生成器 |

当前使用 npm tarball 和随包 Go SDK 交付；npm run pack:packages 构建已校验的包。Go 模块为 github.com/fudanda/arcbase/backend，独立项目通过本地 replace 使用 vendor/arcbase，未声明已发布 npm 包或远程 Go 模块。

## 文档与检查

- [架构导航](AGENTS.md)
- [安装、升级、部署与验收](docs/guide/go-foundation.md)
- [运维 CLI 与项目生成器](docs/guide/go-tooling.md)
- [API Key、S3、SSE 与 MCP](docs/guide/go-integrations.md)
- [ArcBase 更名与升级兼容](docs/guide/arcbase-branding.md)
- [独立管理台](packages/admin/README.md)、[客户端](packages/client/README.md)、[组件](packages/elements/README.md)

提交前执行 npm run check:types、npm run lint、npm test 和 npm run build。真实 PostgreSQL / SQLite 与原页面验收流程由 .github/workflows/go-foundation.yml 定义。

## 来源与许可

ArcBase 基于 [Zenith Admin](https://github.com/iwangbowen/zenith-admin) 的页面与源码继续开发。保留原始 [MIT 许可](LICENSE)、作者版权和历史变更记录。当前 Git 远程仍使用已有仓库地址；界面品牌与本地包更名不代表远程仓库或公共注册表已经发布。
