# @zenith/admin

将原 Zenith 管理台作为一个 React 组件接入宿主。页面、布局、Semi UI、React Router、权限抽屉和业务 hooks 的源码继续位于 `packages/web`；本包提供统一入口、可分发 ESM/类型/样式及本地预览资源，不复制业务页面。

```tsx
import '@zenith/admin/styles.css';
import { ZenithAdmin } from '@zenith/admin';
import { Client } from '@zenith/client';
import { createRoot } from 'react-dom/client';

const client = new Client();
createRoot(document.getElementById('root')!).render(
  <ZenithAdmin
    client={client}
    basePath="/dash"
    assetBasePath="/zenith-assets/"
    brand={{ name: '业务后台', logo: <CompanyLogo />, copyrightName: '公司名称' }}
    theme="system"
    locale="zh-CN"
    navigateExternal={(url) => hostOpenExternal(url)}
  />,
);
```

`client` 可省略，默认使用同源 Cookie 客户端。页面、契约调用、普通/分片上传、上传进度、取消及下载统一使用传入实例。`/auth/me` 恢复服务端会话并写入内存 CSRF；浏览器不存访问令牌。使用宿主客户端的 `onUnauthorized` 时，管理台的会话失效监听仍会保留。

| 属性 | 说明 |
| --- | --- |
| `client` | 稳定的 `@zenith/client` 实例；不传则创建同源客户端 |
| `basePath` | React Router basename，默认 `/dash`，也支持 `/console`、`/` |
| `assetBasePath` | 预设头像和 Monaco 的公开资源根路径，独立于页面路径 |
| `queryClient` | 可选的专用管理台 QueryClient；省略则独立创建 |
| `brand` | 运行时名称、Logo、登录背景图片、版权名称及备案名称/链接；默认沿用原 Zenith |
| `theme` | 默认主题 `light/dark/system`；个人明确选择及服务端锁定策略优先，不写入个人偏好 |
| `locale` | `zh-CN/en-US`：公共组件和 Semi 控件语言；原业务页面固定中文保持原样。省略时保持原控件默认语言 |
| `authSession` | 宿主 Cookie 会话适配器，与 elements 共用；不再额外请求 `/auth/me` |
| `modules` | 宿主业务模块、页面、菜单和页面权限；仅挂载 Go 能力清单确认的页面 |
| `navigateExternal(url)` | 外链菜单及标签页新窗口操作交给宿主，接收完整 HTTP URL；内部路由仍由原 React Router 管理 |
| `loading` | 启动和应用懒加载时的宿主占位内容 |
| `errorFallback(error)` | 启动、配置或应用装配错误的宿主展示 |

这是全页后台应用：每个 document 同时挂载一个实例，组件内部拥有 React Router；在宿主已有 Router 时，把它挂载在 Router 外的独立应用入口。现有全局样式、主题及浏览器偏好存储继续沿用 Zenith 行为。它不是样式隔离的小部件，不支持同一文档同时展示两套账号或后台。

客户端、专用缓存、会话适配器和路径在挂载期间保持不变；切换时用 React `key` 重新挂载。卸载取消当前实例的请求、清空专用查询/变更缓存，移除会话监听与 BroadcastChannel，并恢复挂载前的浏览器存储接口、主题内联样式和 favicon。卸载不会退出服务端会话，也不会清除宿主传入客户端的 CSRF。不要把宿主其他页面的 QueryClient 传入这个专用缓存属性。

生产使用同源 `/api/v1`，由宿主服务器反向代理到 Go，并保留原 Host/Origin。Cookie、CSRF 和后端授权保持 Go 的真实校验。宿主服务器必须支持 `basePath` 下的页面深链接；未知 API、缺失 JS/CSS/WASM/图片应返回真实错误。

## 构建与资源

```bash
npm run build:admin
npm run build:admin:example
npm run build:elements:example
npm run test:admin
```

`dist/` 包含 `index.js`、`index.d.ts`、`types.d.ts`、`styles.css`、懒加载 `chunks/`、`assets/`、`file-viewer/` 与 `public/`。React、React DOM、React Query、client 和 elements 为外部依赖，Admin 与宿主 Elements 共用同一会话上下文；不引用 Web 源码、`@` 别名、历史 Server 或 Node API。原页面的首版构建守卫继续执行。

根目录 `npm run pack:packages` 交付四个编译后的 tarball，并附带 `create-zenith` 独立项目/模块生成器；`npm run test:packages:external` 在仓库外执行真实安装、类型、构建和 Node 导入。宿主模块配置、Go API、权限及完整示例见 [宿主接入说明](../../docs/guide/go-host-integration.md)，完整项目生成与运维见 [Go 工具链](../../docs/guide/go-tooling.md)。

宿主通过 Vite 等工具消费本包时，显式导入 `styles.css`，把 `dist/public/` 的内容复制到 `assetBasePath` 对应的公开目录，并保留 `dist/file-viewer/` 下的本地预览 worker/WASM。JS 中引用的 `assets/` 由宿主打包器处理。如果直接提供 ESM 文件，应完整保留 `dist/` 目录结构；这时省略 `assetBasePath` 会使用模块旁的 `public/`，并由宿主解析上述 peer dependencies。

`examples/minimal-host/` 只从 `@zenith/admin` 和 `@zenith/client` 导入，在 `/console` 挂载。`build:admin:example` 生成可直接部署的 `dist-example/`，包含资源复制示例；无 Web 源码 alias。它同时提供卸载/重挂载验收入口。

真实 Go + SQLite/PostgreSQL 验收（使用隔离测试库，不修改业务库）：

```powershell
$env:ZENITH_TEST_DATABASE_URL='sqlite:./bin/admin-host.db'
$env:ZENITH_BROWSER_TEST_NODE=(Get-Command node).Source
cd backend
go test -tags integration -run '^(TestEmbeddedAdminHost|TestOriginalWebFoundation)$' -count=1
```

本包目前是仓库内 private workspace，未发布到 npm。原项目的 Go 管理台启动使用同一个 `ZenithAdmin` 实现；Web 不反向依赖 admin，依赖方向为 `shared → client → elements → web → admin`。

会话适配器的接口和生命周期见 [@zenith/elements](../elements/README.md)。品牌、语言和默认主题可在运行时更新；卸载恢复原 document 标题、语言、主题和存储接口。
