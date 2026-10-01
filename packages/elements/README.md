# @zenith/elements

可组合的登录、会话、权限、头像与文件组件。复用 Zenith 原有输入、密码、头像和轻量登录校验实现，使用 Semi UI；不依赖 Web、管理台 Router、全局请求实例或浏览器凭据存储。原业务页面仍在 `packages/web`。

```tsx
import '@douyinfe/semi-ui/react19-adapter';
import '@zenith/elements/styles.css';
import { Client } from '@zenith/client';
import {
  ZenithProvider, LoginForm, SessionBoundary, PermissionGuard,
  UserAvatar, FilePicker, FileUploader,
} from '@zenith/elements';

const client = new Client();

<ZenithProvider client={client} locale="zh-CN" navigate={routerNavigate} routes={{ home: '/workspace' }}>
  <SessionBoundary loading="恢复会话…" unauthenticated={<LoginForm />}>
    <PermissionGuard permission="system:file:upload">
      <FileUploader multiple accept="image/*,.pdf" maxSize={10 * 1024 * 1024} />
    </PermissionGuard>
  </SessionBoundary>
</ZenithProvider>;
```

`ZenithProvider` 默认通过 `/api/v1/auth/me` 恢复 Cookie 会话，CSRF 只在传入 Client 的内存中。登录表单使用 shared 契约，处理验证码、服务端失败防护与并发会话确认；不会自动下线其它设备。数据库故障显示不可用，权限判断失败关闭。`PermissionGuard` 只控制 UI，服务端仍执行真正的授权。

`FilePicker` 只选择和校验，不上传。`FileUploader` 使用真实上传接口和 active storage config，提供进度、取消、失败重试和卸载取消；`upload(file, options)` 可注入现有领域上传适配器（例如现有分片上传通道）。服务端控制大小、权限与存储，客户端校验不能替代它。`onUploaded` 返回 shared 的 ManagedFile，`onItemsChange` 返回各文件的进度与结果。取消请求不会撤销已经在服务端提交的文件；若服务端已提交，仍应通过文件列表查询和删除。

宿主已有会话时可传 `authSession: ZenithSessionAdapter`。它提供稳定的 `getSnapshot`、`subscribe`、`login`、`resolveSessionConflict`、`logout`、`refresh` 和 `updateUser`；快照包含 `status/session/error/refreshing`，session 沿用 GoSession。此模式不新建认证观察器、不自动调用 refresh，宿主负责启动、跨页同步和销毁。可通过 `createCookieSession(client)` 创建适配器，先 `refresh()`，最后 `dispose()`。宿主方法应绑定自己的实例，并在状态变化后通知订阅者。

`session: ZenithSessionValue` 是受控桥接入口；原管理台使用它复用当前 GoAuthProvider，组件不会额外请求 `/me`。不要同时传 `session` 和 `authSession`。独立模式的卸载取消请求、移除监听，保留服务端 Cookie 与宿主 Client 的 CSRF。

`locale` 支持 `zh-CN/en-US`，影响公共登录/上传组件和 Semi 控件；服务端错误文案与 Zenith 原业务页面的固定中文不会因此翻译。Provider 不创建全局主题、不接管 document 或宿主存储。品牌的展示布局由宿主决定；整个管理台的品牌配置使用 `ZenithAdmin`。

```bash
npm run build:elements
npm run test:elements
npm run build:elements:example
```

`examples/` 仅导入公开包，使用真实 Go API，产物为 `dist-example/`，部署于 `/elements/`；API 由宿主同源代理到 Go。此包为 private workspace，未发布到 npm。依赖方向：`shared → client → elements → web → admin`。
