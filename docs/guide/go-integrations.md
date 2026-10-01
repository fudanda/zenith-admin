# 集成扩展

原页面继续留在 `packages/web`。可组合组件见 [elements](../../packages/elements/README.md)，管理台品牌、主题、语言和宿主导航见 [admin](../../packages/admin/README.md)。此文说明新增的真实 Go 接口；生产不需要 Node、Redis 或 Worker。

## 升级与配置

执行 `npm run db:migrate`，再构建和启动。版本 11 在 PostgreSQL 与 SQLite 新增 API Key、审计关联与 S3 配置字段，保留原账号、密码摘要、权限和业务数据；已发布 SQL 不改写。服务不会自动迁移。

本地存储可继续直接使用。启用 S3 前配置 `ZENITH_STORAGE_KEY` 为 64 位十六进制随机字符串，重启服务。生成示例：

```powershell
$bytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
$env:ZENITH_STORAGE_KEY = [BitConverter]::ToString($bytes).Replace('-','').ToLowerInvariant()
$env:ZENITH_FILE_STAGING_PATH = 'D:/zenith-data/uploads'
```

密钥需持久保存，并与数据库、文件及暂存目录分别备份；重启时使用相同值。更换或丢失密钥会使已有 S3 凭据及失败清理记录无法解密。Go 宿主使用 `Config.StorageEncryptionKey` 和 `Config.FileStagingPath`，CLI 使用上述环境变量。

## API Key

在原个人中心的 **API Token** 页签创建、查看及撤销。创建时选择现有权限代码，可设置有效期；完整 `zen_...` 密钥仅返回一次，数据库保存摘要。每个用户最多 20 个有效密钥。禁止通配授权，密钥也不能创建其他密钥。

Cookie 登录后可用 `GET /api/v1/api-tokens/permissions` 获取本人可授予的权限；创建、列表及撤销路径为 `/api/v1/api-tokens` 和 `/api/v1/api-tokens/{id}`。这些管理操作只接受 Cookie 会话及 CSRF。

脚本或服务使用受限 Bearer 密钥：

```ts
import { Client, call } from '@zenith/client';
import { positionContract } from '@zenith/shared/identity';

const client = new Client({
  baseURL: 'https://admin.example.com',
  apiKey: process.env.ZENITH_API_KEY!,
});
const page = await call(client, positionContract.list, {
  query: { page: 1, pageSize: 20 },
});
```

密钥客户端默认不携带 Cookie，不要求 CSRF。不要在公开前端构建中写入密钥。权限始终取密钥范围与用户当前权限的交集，数据范围仍执行原规则。角色停用或权限撤销立即生效；账号停用、改密、重置密码、密钥到期或撤销后不能继续使用。认证与业务审计记录密钥 ID，不记录密钥或 Authorization。

开放资源读取、组织/字典维护及文件操作。账号、角色、菜单、授权、安全策略和存储凭据修改不开放给密钥；操作清单决定允许范围。私有文件下载还需要 `system:file:download`，并继续执行文件访问规则。

## S3 兼容文件存储

原 **文件配置** 页面选择 S3，填写 Region、Bucket、Access Key、Secret Key。AWS 可省略 Endpoint；MinIO 等填写完整 HTTP(S) origin，按服务需要开启 Path Style。Bucket 需先创建，账号需具有探测、读写和删除权限。连接测试真实调用 `HeadBucket`。

Secret Key 使用 AES-GCM 加密保存，接口不返回明文；编辑时留空保留原值。可设置对象前缀，存在文件或正在上传的分片时，禁止更改存储位置。

文件列表继续提供普通/分片上传、取消、进度、预览、Range 下载、批量和删除。分片暂存在本地，完成后上传为 S3 对象；文件元数据由 Ent 管理。私有下载经 Go 授权，公开下载通过 Go 公共文件地址，Bucket 本身应保持私有。当前使用代理访问和继承 Bucket ACL；不开放对象公共 ACL、签名直链或 CDN 绕过授权。

删除失败保留可重试元数据。上传后数据库失败会补偿删除对象；删除也失败时，在暂存目录 `.pending-objects` 保存含加密凭据的清理记录，维护任务重启后继续重试，即使原配置已删除。上传大小、文件签名与访问控制沿用基础版规则。

## 实时重查订阅

`GET /api/v1/events` 提供 SSE；支持 Cookie 或受限 API Key。事件只包含审计游标与资源名称，不发送实体数据、字段值或用户信息。收到事件后重新发起正常查询，服务端照常授权。

```ts
import { subscribe } from '@zenith/client';

const subscription = subscribe(client, {
  onChange: ({ resources }) => refreshAuthorizedQueries(resources),
  onUnauthorized: () => endSession(),
  onError: error => reportTemporaryError(error),
});
// 宿主卸载时停止并等待释放读取流。
subscription.close();
await subscription.done;
```

客户端内存保存 Last-Event-ID，断线自动重连；连接、重连及游标过旧时提示重新查询。原管理台已自动接入查询缓存刷新。服务每秒查询持久审计并复核会话/密钥状态，数据库故障不绕过认证；服务关闭会结束订阅。反向代理需允许流式响应并关闭缓冲。此机制使用数据库轮询，适用于当前单体规模，尚无 Redis 广播或大规模消息总线。

## 只读 MCP

地址 `https://HOST/api/v1/mcp`，使用标准 MCP Streamable HTTP（无状态、JSON 响应）。外部工具携带 `Authorization: Bearer zen_...`；浏览器 Cookie 请求仍要求 CSRF 与同源检查。GET/DELETE 返回 405，本端点不提供独立 SSE 会话。

当前读取工具：

| 工具 | 所需权限 |
| --- | --- |
| `users_list` | `system:user:list` |
| `departments_list` | `system:department:list` |
| `positions_list` | `system:position:list` |
| `files_list` | `system:file:list` |
| `login_logs_list` | `system:log:login` |
| `operation_logs_list` | `system:log:operation` |

工具参数为 `page`、`pageSize`、`keyword`，默认第 1 页、20 条，最多 100 条。只向当前身份展示有权限的工具；工具调用再检查权限，读取复用原领域服务和数据范围。文件工具返回元数据，用户查询不含密码或密钥。没有修改、删除、任意 SQL 或绕过权限的工具。MCP 请求审计不保存参数及返回数据。

## 验证

集成测试要求隔离测试数据库及真实 S3 兼容服务；未提供环境时失败，不使用 Mock 代替。CI 启动独立 PostgreSQL 与 MinIO，也运行 SQLite 分组。

```powershell
$env:ZENITH_TEST_DATABASE_URL='sqlite:./bin/integrations-test.db'
$env:ZENITH_TEST_S3_ENDPOINT='http://127.0.0.1:19000'
$env:ZENITH_TEST_S3_ACCESS_KEY='TEST_ACCESS_KEY'
$env:ZENITH_TEST_S3_SECRET_KEY='TEST_SECRET_KEY'
npm test
```

`TestS3RealStorage` 验证真实对象读写、范围下载、私有授权、分片、失败补偿、重启与删除重试。API Key 测试验证范围、撤销和账号权限变化；MCP 使用官方 Go 客户端初始化、列出并调用工具；SSE 验证变更及优雅停机。`TestIntegrationOriginalPages` 使用真实浏览器验证原个人中心、S3 表单、上传与两个页面间的自动刷新，需要已构建 Web 和 `ZENITH_BROWSER_TEST_NODE`。
