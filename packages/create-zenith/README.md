# create-zenith

从已交付包创建独立项目，保留原 `ZenithAdmin`、React Router 和 Semi UI 页面。Node 仅参与生成/开发/构建，生产直接运行宿主 Go 二进制。

```sh
npx --package ./create-zenith-2.58.0.tgz create-zenith my-admin --database sqlite --brand "业务管理台"
cd my-admin
npm install
npm run build
npm run db:migrate
npm run db:seed
npm run init-admin -- admin
npm start
```

PostgreSQL 使用 `--database postgres`，创建后先修改 `.env` 中的连接串。两个数据库是独立安装选择，连接切换不会搬迁数据。生成器不会安装服务、执行数据库写入、初始化固定密码、自动启动或提交项目。

项目包含四个独立 npm tarball 和可携带的 Go SDK 源码版本。Go 的 replace 指向项目自己的 `vendor/zenith`，不引用原仓库；生成项目和原仓库之间没有 workspace 链接。Go/Node 的第三方依赖仍需下载。记录 SDK 版本后，可由宿主自行改为已发布 Go module 版本。

新增业务模块从 JSON 描述生成：

```sh
create-zenith module inventory.json --project my-admin
```

```json
{
  "id": "inventory", "title": "物品管理", "entity": "Item", "scope": "owner",
  "fields": [
    { "name": "name", "title": "名称", "type": "string", "maxLength": 64 },
    { "name": "code", "title": "编码", "type": "string", "maxLength": 64, "unique": true },
    { "name": "quantity", "title": "数量", "type": "int" },
    { "name": "active", "title": "启用", "type": "bool" }
  ]
}
```

支持 string/int/bool、required、unique。默认 owner：普通用户仅访问自己创建的记录，超级管理员可访问全部；明确 `scope: all` 才开放组织共享记录。动作仍受各自权限控制。生成后运行 build、migrate、seed、test，使用原菜单/角色授权分配 `host:{id}:list/create/update/remove`。

生成器输出 shared 契约、OpenAPI/Go DTO、Ent schema、领域 Service、薄 handler、模块生命周期、显式 PostgreSQL/SQLite 迁移、同事务审计、查询 hooks、权限按钮和原 Semi UI 页面。已存在文件、模块或实体拒绝覆盖；已执行的模块迁移摘要不允许修改。后续字段变更需新增版本，不能重新运行模板覆盖业务实现。复杂关系、部门数据范围、导入导出需要在生成后按实际业务补充，未生成的能力不会返回假成功。
