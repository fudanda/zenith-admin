# 运维 CLI、独立项目与业务模块模板

三个入口复用当前单组织 Go 基础版和原 `ZenithAdmin`。当前管理台仍在 `packages/web`；生成业务页面挂在宿主扩展菜单，原页面、布局和权限抽屉保留。

## 运维命令

构建后直接使用 `backend/bin/zenith.exe`（Linux 为 `zenith`）。二进制读取环境变量；仓库开发命令由 `scripts/go.mjs` 加载 `.env.go`。

```powershell
npm run version:go
npm run check:go
npm run reset-admin -- admin
# 随机密码只写入指定本地文件，不输出到终端：
npm run reset-admin -- admin --generate --credentials-file .env
```

`version` 输出 SDK 版本、源码提交、构建时间和数据库版本；未提交源码以 `-dirty` 标识。`check` 检查数据库版本、监听地址、目录写权限、存储密钥、S3 凭据解密和宿主模块版本，不输出连接串和凭据，也不执行迁移。

`init-admin` 与 `reset-admin` 交互输入隐藏密码，也支持从标准输入读取。重置只接受启用的超级管理员，遵守当前密码策略，在同一事务中更新摘要、撤销会话、清除登录失败记录并写审计。凭据文件保留其他变量；失败恢复原文件。启动不会读取凭据变量重新设置密码。

## 统一备份与恢复

先停止所有写入实例，再备份。服务运行时持有共享维护锁；统一备份、迁移和恢复使用排他锁。锁只能约束采用此版本 SDK 的进程，升级旧实例时仍必须先停机。

```powershell
npm run backup:go -- backend/backups/snapshot
# Windows 上可复用 PostgreSQL 容器里的 pg_dump/pg_restore：
npm run backup:go -- backend/backups/snapshot --pg-container MY_POSTGRES_CONTAINER
```

备份目录包含数据库快照、所有已配置本地目录、已登记 S3 对象、上传暂存目录、存储加密密钥及 SHA-256 清单。数据库版本不匹配、已登记文件丢失或内容不匹配时失败。输出目录必须全新；完整备份完成后才重命名到目标目录。PostgreSQL 原生工具必须与服务器版本兼容；密码通过环境或容器标准输入传输。备份针对完整数据库，不接受自定义 `search_path`。

```powershell
# 先将 ZENITH_DATABASE_URL 指向新空 PostgreSQL 数据库或全新 SQLite 文件。
npm run restore:go -- backend/backups/snapshot --files-root D:/recovery/files --env-file D:/recovery/restored.env
# S3 对象恢复到新的本地目录，需明确选择：
npm run restore:go -- backend/backups/snapshot --files-root D:/recovery/files --env-file D:/recovery/restored.env --s3-to-local --pg-container MY_POSTGRES_CONTAINER
```

恢复先验证清单，拒绝覆盖数据库、文件目录和环境文件。原 S3 Bucket 不改动。S3 上传分片缓存随文件恢复，原远端补偿记录保留在新暂存目录 `.source-s3-journal`，供人工恢复，不在本地克隆中执行。恢复后的文件配置指向新目录，管理员密码摘要和业务数据保留；使用 `restored.env` 的数据库、目录和密钥启动。目标数据库与备份必须为同一种方言，切换数据库连接不会搬迁数据。备份含真实凭据和会话摘要，应按私密数据保存。

`zenith verify-backup DIRECTORY` 可独立校验备份。`backup-sqlite` 保留为仅数据库快照命令；完整恢复应使用上述统一备份。

## 创建独立项目

执行 `npm run pack:packages`，交付目录 `release_artifacts/packages/` 新增 `create-zenith-2.58.0.tgz` 和 `scaffold.json`。当前交付为本地 tarball，没有发布 npm Registry。

```powershell
npx --package ./release_artifacts/packages/create-zenith-2.58.0.tgz create-zenith D:/projects/my-admin --database sqlite --brand "业务管理台"
cd D:/projects/my-admin
npm install
npm run build
npm run db:migrate
npm run db:seed
npm run init-admin -- admin
npm start
```

PostgreSQL 选择 `--database postgres`，初始化前修改新项目 `.env`。生成器只创建新目录，不执行安装、数据库写入或固定密码初始化。

新项目携带四个 npm 包 tarball、带校验清单的 Go SDK 源码和自身 `go.mod`，不指向 Zenith 仓库或 workspace。`vendor/zenith-sdk.json` 和项目清单记录版本、提交及源码摘要。开发/构建需要 Node 24 和 Go；构建后的 Go 二进制内嵌管理台，生产不需要 Node。

## 生成业务模块

模块字段由 JSON 显式描述，模板不会猜测业务模型。示例见 [create-zenith README](../../packages/create-zenith/README.md)。

```powershell
# 安装工具 tarball 后：
create-zenith module inventory.json --project D:/projects/my-admin
cd D:/projects/my-admin
npm run build
npm run db:migrate
npm run db:seed
npm test
```

输出包含领域契约、OpenAPI 3.0.3、Go DTO、运行时 JSON Schema 校验、Ent 模型、Service、HTTP handler、模块生命周期、双数据库版本迁移、菜单/按钮种子、查询 hooks、Semi UI 页面和真实接口测试。模块使用宿主唯一数据库池；业务写入与审计由 `HostData.Write` 在同一事务完成。运行时只检查模块版本，不自动建表。

权限为 `host:模块:list/create/update/remove`，可在原用户、角色和用户组授权抽屉分配。默认 `scope: owner` 限制普通用户访问本人创建记录，超级管理员访问全部；`scope: all` 明确选择组织共享。模板数据范围独立于系统账号的部门范围，复杂关系和部门数据范围须按实际业务补充。

支持 string/int/bool、可空字段、唯一约束、分页和关键字筛选。更新保留省略字段，显式 null 清空可空字段。Query 缓存键由 shared 的 `contractKey` 派生；写入刷新相关列表/详情，SSE 重新查询服务端授权视图。宿主模板通过公开包编写页面，不能导入 Web 私有 hooks 或组件。

生成器拒绝覆盖已有实现。已应用迁移校验摘要，新增字段应追加迁移版本。导入导出、复杂关联、部门范围等业务功能不由基础模板自动生成。

## 验证

`npm run test:tooling` 验证字段与路径约束、生成结果及覆盖保护。`npm run test:tooling:external` 在仓库外安装工具和四个 tarball，生成独立项目与模块，执行 Ent/DTO 生成、类型检查、生产构建、契约漂移检查、真实 SQLite CRUD/权限/审计回滚测试。设置 `ZENITH_TEST_DATABASE_URL` 后，相同生成测试也验证 PostgreSQL。

Go 集成测试新增 `TestRealDatabaseAndS3BackupRestore` 和 `TestGeneratedStandaloneBinaryBrowser`。后者使用生成项目的实际二进制，覆盖原登录、CRUD、筛选、刷新、实时更新、窄屏和静态深链接；CI 对 PostgreSQL 和 SQLite 均执行。测试数据库和 S3 Bucket 均独立创建，不使用现有业务库。
