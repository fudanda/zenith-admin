# @arcbase/client

单组织 Go 基础版的独立 TypeScript API 客户端。运行时只依赖 `@arcbase/shared`，不依赖 React、Semi UI、TanStack Query、Web 源码或浏览器存储。支持 workspace 开发和根目录 `pack:packages` 的编译后 tarball 交付，可在仓库外安装，并由普通 Node 直接导入 ESM。

```ts
import { Client, call, operationURL } from '@arcbase/client';
import { goAuthContract, positionContract } from '@arcbase/shared/identity';

const client = new Client({
  onUnauthorized: () => { /* 由宿主更新登录状态 */ },
});

// 浏览器发送 HttpOnly Cookie；刷新页面后重新获取 CSRF。
const session = await call(client, goAuthContract.me);
client.setCsrfToken(session.csrfToken);

const page = await call(client, positionContract.list, {
  query: { page: 1, pageSize: 10, keyword: '工程' },
});

const csv = await client.readBlob(operationURL(positionContract.exportCsv, { query: {} }));
```

## 职责

- `Client`：JSON、原始响应、multipart 上传、XHR 上传进度、取消和二进制下载；统一 Cookie/CSRF、请求头、链路 ID 和错误处理。
- `call` / `callRaw`：从 shared 契约派生 `/api/v1` 路径、参数和响应；执行响应校验及单组织设置投影，保留更新时省略的字段。`call` 解包数据并抛业务错误，`callRaw` 返回 `{ code, message, data }`。
- `operationURL`：为上传、预览和下载生成契约路径。未开放操作会在发送请求前被拒绝。
- `ClientError`：无会话、网络故障、响应格式或下载错误，含 `status`、`reason` 和可用的 `requestId`；取消保留 `AbortError`。`ApiError` 表示非零业务响应码。

登录可通过 `call(client, goAuthContract.login, { body: ... })` 发起；登录成功后由宿主用响应中的 `csrfToken` 更新客户端。退出、改密后由宿主清除 CSRF 和用户状态。认证请求返回 401 时客户端清除 CSRF 并调用 `onUnauthorized`，503 不清除会话。登录失败不触发宿主强退事件。

```ts
import { fileContract } from '@arcbase/shared/platform';

const form = new FormData();
form.append('file', file);
await client.postForm(operationURL(fileContract.uploadOne), form, {
  signal: controller.signal,
  onProgress: percent => { /* 由宿主显示进度 */ },
});
```

实际应用应通过 `operationURL(fileContract.uploadOne)` 获取上传路径，复用 shared 契约。文件下载返回 Blob；保存文件、Toast、重定向、用户信息和查询缓存由宿主负责。普通上传与进度上传使用相同的最新 CSRF，浏览器自行生成 multipart boundary。

默认同源，`baseURL` 可显式设置为 HTTP origin；客户端不会接受请求路径中的外部 URL。`transport` 可注入 fetch，`xhrFactory` 可注入上传实现。Node 调用需要注入维护 Cookie 的 transport；Node 的原生 fetch 不会自动保存服务端会话 Cookie。

宿主业务使用 `new Client({ operations: [hostContract.list] })` 明确注册 `/api/v1/extensions/` 契约，随后通过 `call` 调用；注册彼此隔离，不影响其他 Client 的首版限制。详见 [宿主接入说明](../../docs/guide/go-host-integration.md)。

## 验证

```sh
npm run check:types
npm run check:boundaries
npm run test:client
npm run lint -w @arcbase/client
```

Web 的 `go-transport`、`go-api-client` 和文件请求仅保留宿主适配；React Query hooks、会话 Provider、下载保存和提示仍位于 `packages/web`，原页面沿用原来的调用入口。

## 脚本密钥与订阅

`new Client({ baseURL, apiKey })` 使用受限 Bearer API Key，默认 `credentials: 'omit'`，不要求 CSRF；客户端不保存密钥到浏览器存储。Cookie 模式行为保持不变。服务端同时检查密钥范围、用户当前权限及数据范围；密钥不能管理密钥、授权或安全设置。

`subscribe(client, { onChange, onUnauthorized, onError })` 提供 fetch SSE，兼容 Cookie 与 Key。变更只提示重新查询，支持内存游标、断线重连及认证失效终止。返回 `{ close, done }`；宿主卸载时调用 `close()` 并等待 `done`，查询缓存由宿主管理。

完整示例、接口、S3 和只读 MCP 说明见 [集成扩展](../../docs/guide/go-integrations.md)。
