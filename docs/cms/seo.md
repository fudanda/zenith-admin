# SEO 与流量

## Social SEO

全部内置主题、动态 SSR、静态页和草稿预览统一输出 `og:url`、`og:site_name`、图片说明、Article 发布时间/修改时间/作者，以及完整 Twitter Card（card/site/creator/title/description/image/image alt）——SEO head 为主题共享组件（`SeoHead`），主题复用该组件即可获得全套输出。站点配置提供默认 Twitter 账号、Card 类型和图片说明，内容可覆盖作者账号与社交图片说明。

## 三级 TDK 覆盖

SEO 标题/关键词/描述按 **内容 → 栏目 → 站点** 三级向上回退，留空即继承。详情页额外输出 canonical、Open Graph 与 Article JSON-LD 结构化数据。

## SEO 管理页

「SEO 管理」（权限 `cms:seo:manage`）包含四个 Tab：

### 301/302 重定向

站内旧路径 → 新地址映射，前台路由优先级最高。**目标地址仅允许站内路径（`/` 开头）或本系统站点域名的完整 URL**——创建/更新时校验 + 解析时兜底双重防护，杜绝开放重定向被用作钓鱼跳板。

### 内链词

正文关键词自动加链（SEO 内链建设）。仅处理 HTML 文本节点，跳过 `<a>/<script>/<style>` 内部，每词限次替换；URL 经 HTML 属性转义防注入。链接目标在写入层经过共享 CMS URL policy 校验，可按字段使用站内路径、`entity:` 引用或允许的 `http(s)`/`mailto`/`tel`，协议相对地址、反斜杠、`javascript:`、`data:` 等危险值直接拒绝。

### 搜索推送

发布内容后自动向搜索引擎主动推送，此 Tab 也支持手动批量推送历史 URL（`POST /api/cms/seo/push`，权限 `cms:seo:push`）：

- **百度普通收录**：站点配置 `baiduPushToken`
- **IndexNow**（Bing 等）：站点配置 `indexNowKey`，key 校验文件自动托管于 `/{key}.txt`

推送凭证在「站点管理 → 编辑站点 → 搜索推送」中配置，且需绑定站点域名。推送结果（成功/状态码/响应）留痕于 `cms_push_logs`，Tab 内可查推送日志。

### 死链检测

提交任务中心任务（`cms-deadlink-check`，`POST /api/cms/seo/deadlink-check`），扫描已发布、未回收、未归档且未过期内容正文及已启用友情链接中的站内/外部链接。常规栏目与内容路径按数据库查库，外链经统一 `http-client` 外呼并启用 SSRF 防护；外链最多探测 200 条，输出死链行级明细。自定义 `staticPath`、带归档目录的详情路径和标签页由运营结合路由规则人工复核，检测结果作为辅助检查，不阻断发布。

## sitemap / robots / RSS

- `sitemap.xml`：动态生成（Redis 600s 缓存），含首页、有效启用的非外链栏目、非外链内容、标签和已发布搭建页，上限 5 万条；内容条件为 `published + 未回收 + 未归档 + 未过期`
- `robots.txt`：站点级独立配置
- RSS 2.0：站点级 `/rss.xml` 与栏目级 `/{channelPath}/rss.xml`，每个 feed 返回最新 50 条符合上述公开条件的内容；外链内容使用其解析后的目标地址。站点级 feed 对每条内容检查其主栏目自身及全部祖先栏目有效启用；栏目级 feed 还要求请求栏目自身及全部祖先栏目有效启用，停用栏目不提供 feed。

通过发布 outbox 的内容、栏目、页面、部件和其他公开配置变更在事务提交后清理站点级 sitemap/RSS Redis 元数据缓存，静态文件由异步任务生成或删除；浏览器或 CDN 已缓存的响应仍受 HTTP `Cache-Control` 生命周期约束，配置了 CDN purge 时再异步发送受影响路径。

## Webhook 事件外推

站点设置「Webhook」配置回调地址（可选签名密钥）后，内容变更事件自动 POST 推送到该地址。站点级 Webhook 底层托管为开放平台统一投递管线的一条 `internal` 订阅（`app_webhook_subscriptions` + `app_webhook_deliveries`），因此在事件成功登记后自带 **HMAC 签名、`eventId` 去重、指数退避重试（1/5/30/180/720 分钟五档）、连续失败自动禁用、投递日志与手工重投**；outbox 登记失败只记录日志，不阻断业务，需由监控发现。

| 事件 | 触发时机 |
|------|---------|
| `cms.content.published` | 手动发布 / 工作流通过 / 定时发布 |
| `cms.content.updated` | 内容更新 |
| `cms.content.offline` | 手动下线 / 过期自动下线 |
| `cms.content.recycled` | 移入回收站 |
| `cms.content.deleted` | 彻底删除 |

请求体为统一事件信封：

```json
{
  "type": "cms.content.published",
  "eventId": "8f0d…（UUID）",
  "clientId": null,
  "scope": { "siteId": 1 },
  "occurredAt": "2026-07-20 12:00:00",
  "data": {
    "site": { "id": 1, "code": "main", "name": "主站" },
    "content": { "id": 42, "channelId": 3, "title": "…", "slug": null, "status": "published", "version": 3, "publishedAt": "…" }
  }
}
```

投递请求头携带 `X-ArcBase-Event` / `X-ArcBase-Event-Id` / `X-ArcBase-Delivery-Id` / `X-ArcBase-Attempt`；配置签名密钥后附加 `X-ArcBase-Signature: t={unix},v1={HMAC-SHA256(secret, "{t}.{body}")}`，接收方验签防伪造。

事件在**业务事务内**先落任务中心 outbox（`cms-webhook-emit`），worker 再发射到事件总线并持久化投递记录；成功登记并提交事务后，worker 崩溃或投递失败可由 pending 恢复扫描与退避重试处理。若 outbox 登记本身失败，业务事务仍会提交并只记录错误日志，调用方应通过监控发现该类丢失。可靠性机制与面向开放应用的事件订阅详见 [开放能力（Headless API）](./open-api#webhook-事件外推)。
