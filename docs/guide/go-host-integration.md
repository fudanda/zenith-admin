# 独立包交付与宿主业务模块

管理台仍是 `packages/web` 的原 React Router、Semi UI 和业务页面。`@zenith/admin` 提供装配入口；宿主业务页面通过 `modules` 配置接入，后台通过 Go `Config.Modules` 接入。宿主不需要导入 Web 源码或配置 workspace alias。

## 交付和独立安装

在项目根目录使用 Node 24：

```sh
npm ci
npm run pack:packages
npm run test:packages:external
```

`release_artifacts/packages/` 生成 Shared、Client、Elements、Admin 四个 `.tgz` 和带 SHA-256 的 `index.json`。包保留 `private`，交付使用 tarball；此命令不会发布到公共 npm registry。正式入口为编译后的 ESM 和 `.d.ts`。Shared、Client 的 `development` 条件提供包内源码以支持 Vite 开发，生产和普通 Node 导入使用 `dist`。

外部项目需同时安装四个 tarball，以及 React 19、React DOM、TanStack Query、Semi UI、Zod 等 peer dependencies。`examples/host-application/package.json` 是完整依赖示例。外部验收命令创建 OS 临时目录，执行真实 npm 安装、检查四个包没有 workspace 符号链接、执行 TypeScript 和 Vite 构建，再用普通 Node 导入编译后的 SDK。

显式导入 `@zenith/admin/styles.css`。把 `node_modules/@zenith/admin/dist/public/` 复制到 `assetBasePath` 对应的公开目录，保留 `dist/file-viewer/` 下的预览运行资源。示例 `build.mjs` 完成资源复制，未设置任何源码 alias。

## 前端宿主模块

```tsx
const client = new Client({ operations: [hostContract.list, hostContract.create] });
const modules: ZenithAdminModule[] = [{
  id: 'position-host', title: '宿主业务',
  pages: [{ id: 'positions', title: '岗位业务模块',
    path: '/extensions/position-host/positions', permission: 'system:position:list',
    component: PositionsPage }],
}];
<ZenithAdmin client={client} modules={modules} basePath="/console" />;
```

模块 ID 和页面 ID 使用小写字母、数字、连字符。页面路径必须位于 `/extensions/{module.id}/`，只支持明确声明的静态页面路径；禁止覆盖内置页面、通配符或路径参数。页面获得稳定 Client、当前用户和服务端权限集合。按钮使用 Elements 的 `PermissionGuard` 或页面属性 `hasPermission`；Admin 与 Elements 共用上下文，页面不会创建第二套会话。

管理台仅在配置了宿主模块时读取 `/api/v1/modules`，按 Go 已装配的模块、页面和权限匹配前端声明；能力查询失败显示可重试错误，未装配的模块不注册入口。默认原管理台不会增加这项请求。

宿主菜单使用负数 ID，与数据库正数 ID 分离，自动进入原导航、标签页和页面缓存。没有页面权限时隐藏菜单，直接访问已有宿主页面显示 403。服务端仍独立授权。宿主配置需稳定，模块代码和 Go 模块由宿主一起部署；本接口不会动态加载未知脚本或替未实现 API 返回成功。

Client 的宿主契约必须明确传入 `operations`，路径限定为 `/api/v1/extensions/`。注册只作用于该 Client 实例；内置首版操作仍按原清单限制。`call` 执行请求体和响应 schema 校验，PUT/PATCH 保留省略字段；宿主字段不经过内置单组织字段投影。

## Go 宿主模块

实现公开 `zenith.Module` 的名称、依赖、初始化和关闭方法。可选实现：

- `ServiceModule.BindServices`：注入 `HostServices`，仅做依赖绑定，不启动资源或后台任务。
- `DescribedModule.Extension`：声明页面及自定义权限。新权限使用 `host:{module.name}:{action}`；内置权限可直接复用。

`Extension` 用于允许原菜单管理配置宿主页面/按钮，并允许 Go 在已声明的 `/dash/extensions/...` 页面提供 SPA 深链接。原菜单管理新建宿主页面时，组件值必须为 `host:{module.name}:{page.id}`，权限与声明一致。角色、用户直接授权和用户组继续使用原授权方式。撤销权限后，后续 Go 请求立即拒绝。

自定义权限的 TypeScript 类型通过 `@zenith/shared/core/permissions` 的 `HostPermissionRegistry` 接口增补，示例见 `examples/host-application/permissions.ts`。岗位示例新增按钮同时要求 `host:position-host:create` 和原 `system:position:create`：宿主包装不能绕过原领域权限。两项权限都可通过原菜单/角色授权维护。

HTTP handler 使用 `CurrentActor(ctx)` 获取操作人和追踪信息，不返回会话、密码或 Cookie。`HostServices.Authorize(ctx, permission)` 使用当前数据库授权。公开 Positions 服务示例复用原岗位业务服务、数据范围和同事务审计，缺少经过门禁的业务上下文时拒绝调用。宿主新增领域自行管理业务 schema、版本迁移、Service 与显式事务；通用扩展接口不提供绕过业务规则的任意表 CRUD。

宿主契约仍从自己的 Shared schema 生成。示例 `contracts.ts` → `generate:host-example` → `contract.gen.json` → `RegisterHostContract`。注册时编译请求 JSON Schema，统一执行查询、路径和 body 校验，并挂载 Cookie、CSRF、权限、审计元数据。自定义写操作默认不记录请求 body；需要记录时明确声明并过滤秘密。宿主业务写入必须与审计同事务。示例宿主接口首版仅接受 Cookie 会话，未开放 API Key。

```sh
npm run generate:host-example
npm run check:host-example
cd backend
go test ./...
```

Go 示例位于 `backend/examples/hostmodule/`，仅导入 Zenith 公开 API；使用依赖 `organization.positions`。`examples/host-application/` 的页面通过真实宿主岗位接口读写，原岗位页面能看到同一条记录。

## Go 承载外部页面

在独立宿主目录设置 `ZENITH_HOST_BASE_PATH=/dash/` 后构建，Go 使用 `DashboardFS` 指向该 `dist`，并注册宿主模块。`backend/examples/hostembed/` 展示装配方式：设置数据库、监听地址、文件配置和 `ZENITH_HOST_DIST` 后运行。

HTTP 回退仍只服务内置和声明过的页面。未知 API、未声明页面与缺失 JS/CSS/WASM 返回真实 404。宿主自己的服务器部署 `/console` 时负责同等深链接策略，并将 `/api/v1` 同源代理到 Go，保留 Host 和 Origin。

验收使用真实 SQLite 与 PostgreSQL：登录验证码、Cookie/CSRF、非法参数、读写权限拒绝、权限撤销、审计、外部包页面查询和新增、原岗位页面数据一致、刷新恢复、过滤以及普通用户按钮隐藏。测试管理员使用随机密码，业务部署中的现有管理员不被重置。
