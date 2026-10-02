# 互动与运营

## 会员互动（点赞 / 收藏 / 浏览历史）

前台详情页底部渲染**互动条**（点赞/收藏按钮 + 计数，静态页可用）：内联 JS 读取会员 token（`arcbase_member_token`），已登录调用 `/api/member/cms/contents/{id}/like|favorite` 并自动上报浏览历史；未登录点击跳会员端登录。

- **点赞/收藏**：会员×内容唯一（`cms_content_likes` / `cms_content_favorites`），计数原子回写 `cms_contents.like_count/favorite_count`，后台内容列表展示「赞/藏」列
- **浏览历史**：`cms_member_view_history` 去重累计，每人保留最近 100 条；会员中心「我的收藏」「浏览历史」页支持取消收藏/清空
- **积分联动**：阅读 +1（日限 10）、点赞 +1（日限 5）、收藏 +2（日限 5）、投稿发布 +10，复用积分中心 `changePoints()` 记账（`bizType='cms_interaction'`）；Redis `SET NX`（30 天窗口）防同内容重复给分 + 日限额计数，取消后再操作不重复给分。规则常量：`@arcbase/shared/cms` 的 `CMS_INTERACTION_POINTS` / `CMS_INTERACTION_DAILY_LIMITS`

## 统一互动问卷

后台统一入口 `/cms/interactions`（权限 `cms:interaction:list|manage|batch|export`），问卷与投票共用同一套表、API 与设计器：

- `kind=survey|poll`；题目支持 single / multiple / text / **rating（评分）/ nps / matrix（矩阵）/ date / number**，poll 由服务端约束为**恰好一道单选或多选题**。
- 题目扩展能力：单选/多选可开「其他 ___」自由填空（答案存 `__other__:自由文本`，统计归入同一桶且原文回传）；矩阵题的行存 `matrix_rows`、列复用 `options`，答案存 `rowId::optionValue`；`page_no` 支持分页问卷；`visible_when`（`{questionIndex, op: any|none, values}`）支持条件显示，**只能依赖排在前面的单选/多选题**，条件未命中的题目服务端不做必答校验也不落库。
- 参与范围 `anonymous|member`，重复策略 `once_per_member|once_per_ip|multiple`，结果可见性 `always|after_submit|after_close|hidden`，验证码 `inherit|none|math|turnstile`。Turnstile 复用统一 captcha adapter，密钥只写不回显，验证失败或依赖故障均 fail-closed。
- 前台页 `/interaction/{code}/`，正文嵌入标记 `[互动:code]`；公开提交 `/api/public/cms/interactions/{siteCode}/{code}/submit`，会员提交 `/api/member/cms/interactions/{id}/submit?siteId={siteId}`。会员接口同时按互动 id、站点 id 和站点祖先链启用状态校验，避免跨站枚举。
- 前台表单：题目按 `page_no` 分页（进度 + 上一页/下一页），条件显示随选择实时联动；多选的必答与最少/最多选择数、矩阵每行必答、「其他」填空是否为空均在**浏览器侧先校验**并把错误内联渲染到对应题目下（提交失败也不再用 `alert()`）。分页只影响可见性，跨页答案统一提交；提交出错时自动翻回出错那一页。填写内容按站点+标识存 localStorage 草稿，刷新可断点续答，提交成功后自动清除。
- 答卷写入 `cms_interaction_responses + cms_interaction_answers`，IP 只保存加盐哈希；`repeat_key` 与显式请求幂等键分别有唯一屏障。选择题按参与人数统计，文本题仅管理接口返回，公共状态与提交响应不会包含 `texts`。题目替换与提交共用 interaction 行锁，已有答卷后不能换题——此时用 `POST /api/cms/interactions/{id}/copy` 生成草稿副本；问卷级配置及题目的 `label/type/required/options/minChoices/maxChoices/sort/allowOther/otherLabel/ratingMax/matrixRows/pageNo/visibleWhen` 全量复制，标识自动加 `-copy` 后缀去重、答卷数归零。
- 答卷明细与导出均关联题目输出可读答案（`answerDetails`：选项 value 反查文案，选项被改名/删除时回退原始 value）；答卷可按具体问卷筛选，选定单份问卷导出时按题目展开为**宽表**（一题一列、表头即题干），跨问卷导出回退为答案 JSON 单列。
- 批量发布/关闭走任务中心 `cms-interactions-batch-status`，含 checkpoint、行级 items、权限复验、取消与重试；答卷导出实体为 `cms.interaction-responses`，原始导出另需 `cms:interaction:export-raw`。
- 后台设计器（`pages/cms/interaction/`）为全屏三步弹窗：①基本信息（标题自动生成拼音访问标识）②题目设计（题目/选项/矩阵行均可上下移、题目可复制、选项行内增删或「批量编辑」按行粘贴，可设分页与条件显示，内置满意度/NPS/报名/体验评分/单题投票模板）③参与与展示（Turnstile 收进「高级」折叠，验证码策略切换时才必填）。右侧常驻前台样式预览（≥lg 宽度），按页分组渲染全部题型。`kind=poll` 在 UI 层即收敛为单道选择题、隐藏其他题型与分页，「每位会员一次」在参与范围非仅会员时禁选并自动回退；题目排序/删除后条件引用自动重算，失效即清空；校验错误定位到具体题目卡片与出错步骤，已有答卷时顶部 Banner 提示并锁定题目结构。
- 结果统计按题型分化：选择题给选项分布，评分/NPS/数字给 `average`（NPS 另给 `npsScore` 净推荐值：推荐者 9-10 占比 - 贬损者 0-6 占比），矩阵给按行的分布，文本/日期给最近样本；`answered` 为该题实际作答人数（条件显示题会小于总答卷数）。
- 统计全部在 SQL 侧 `GROUP BY` 聚合（数组与标量答案由 `LATERAL` 统一摊平），不把答案拉进内存，无结果集规模上限。后台结果面板为三个 Tab：**题目分布**（含文本/日期/「其他」填空的分页浏览与关键词搜索，`GET /{id}/stats/texts`）、**交叉分析**（两道单选/多选题的联合分布，`GET /{id}/stats/cross`）、**提交趋势**（按天补齐空缺日期，`GET /{id}/stats/trend`）。

## 评论

- **提交**：前台原生 form POST `/api/public/cms/comments`（静态页可用），Redis IP 限流（60s 5 次）+ 蜜罐字段 + 规则中心名单守卫 + 敏感词过滤，入库后待审核
- **树形回复**：支持两级回复树——回复「回复」时自动挂到顶级评论下；前台每条评论带「回复」按钮（内联 JS 定位表单并填充 parentId）
- **点赞**：匿名点赞 `/api/public/cms/comments/{id}/like`，同 IP 对同评论 24h 去重
- **审核**：后台按状态 Tab 批量通过/拒绝/删除（权限 `cms:comment:list|audit|delete`），过审自动触发详情页静态刷新；列表展示回复对象、点赞数和「观察主体」徽标（`riskFlag = 'watchlist'`）

## 自定义表单

- 表单定义（8 种字段类型：`text` / `textarea` / `select` / `radio` / `email` / `mobile` / `url` / `number` + 必填 + 选项 + 字段级验证规则）。同一表单内字段 `name` 必须唯一；`select`/`radio` 的提交值必须命中已配置选项，定义阶段应配置至少两个不同 value。前台按栏目 `settings.formCode` 绑定展示，原生 form POST 提交（`POST /api/public/cms/forms/{siteCode}/{formCode}`）
- 提交防护：IP 限流 + 蜜罐 + 按字段定义校验 + 规则中心名单守卫 + 敏感词；名单主体包含 IP，以及字段类型或字段名匹配 `email|phone|mobile|tel` 的联系方式
- **通知邮箱**：配置后新提交异步邮件通知（多邮箱逗号分隔）
- **数据导出**：提交数据抽屉支持导出中心导出（entity `cms.form-submissions`，按表单字段动态生成列）

## 广告

- 广告位（模板引用标识）+ 广告（图片/链接/投放时间窗/排序）
- 页面渲染后先从 `/api/public/cms/ads/tokens/{siteCode}` 领取 5 分钟一次性事件令牌，再上报曝光或启用 `/api/public/cms/ads/{id}/click?token=`。令牌签名绑定 site/ad/page、可信代理解析后的访客指纹、通道和可选会员；伪造 UA、篡改或重放均拒绝，静态页同样在浏览器渲染后领取新令牌。
- 点击只允许仍在投放且站点仍启用的广告，广告跳转目标由服务端限制为站内相对路径或无凭据的 http/https URL；友链、内链词、重定向、主题参数、页面区块和页面部件的链接字段均在写入层执行共享 URL policy，拒绝 `javascript:`、`data:`、协议相对地址、反斜杠和其他危险协议。
- `cms_ad_events` 追加记录 site/ad/slot、impression/click、发生时间、访客/IP 哈希、UA/设备/来源/路径及可选会员。曝光按广告+访客+60 秒桶、点击按 10 秒桶去重。
- 事件插入、`cms_ads` 计数与 `cms_ad_stats` 日聚合在同一事务中按**实际插入事件**批量更新，保证三者一致；一次曝光请求最多 50 个广告，不逐事件多表重写。
- 后台 `/cms/ads` 为「广告 / 事件明细 / 统计」页内 Tabs。事件可按完整维度和时间范围筛选，导出实体 `cms.ad-events`；原始导出另需 `cms:ad-event:export-raw`。
- 保留期由「数据保留」中的 `cms_ad_events` 策略统一控制（默认 180 天）；每日 `data-retention` 系统任务按该策略清理，人工按站点清理仍走任务中心 `cms-ad-events-cleanup`，支持 checkpoint/items/取消/重试。

## 会员订阅与发布触达

- `cms_member_subscriptions` 统一 site/channel/author。author 键采用 **Unicode NFKC → trim → 连续空白折叠 → locale lowercase**；展示文本只作快照，不参与唯一性。
- 会员 API 全部使用 `memberAuthMiddleware + currentMemberId()`；订阅 upsert、取消留痕、状态查询、通知开关和分页列表均幂等且不接收外部 memberId。只允许启用站点、启用栏目与已发布公开内容中的作者，避免枚举内部对象。
- 站点页头、栏目页、内容作者旁提供关注按钮；会员中心「我的关注」管理订阅，并直接复用既有签到状态/签到 API。
- 首次有效订阅奖励复用积分中心，`bizType='cms_interaction'`，`bizId='subscribe:{site}:{type}:{subjectHash}'`，受每日 `subscribe` 上限控制；`points_awarded_at` 永久保留，取消不倒扣、重新关注不重发。
- 内容发布事务以系统身份写入 `cms-subscription-notify` outbox 任务并固化订阅 cutoff；worker 每批发送前复验站点及其祖先链、主栏目有效启用、内容版本仍满足 `published + 未回收 + 未归档 + 未过期` 通知查询条件，调用既有 `createMemberNotification()`，以内容版本 bizId 去重，不阻塞发布事务。当前通知匹配站点、主栏目和标准化作者订阅，副栏目订阅不参与收件人计算；发布者不能查看收件人任务项，也不能取消、恢复或重启内部通知任务。
- 后台 `/cms/subscriptions` 查看聚合与脱敏明细，权限 `cms:subscription:list|export`，导出实体 `cms.subscriptions`，原始导出另需 `cms:subscription:export-raw`。

## 敏感词

全局词库，两种处理方式：**拦截**（replaceWith 为空，命中拒绝提交）与**替换**。应用于评论与表单提交。公开评论/表单提交同时接入规则中心名单守卫：`risk_blacklist` 命中返回 403，`cms_watchlist` 命中仅标注观察。名单配置与求值留痕见 [规则中心](/rules/evaluation)。

引擎：**Aho-Corasick 多模式匹配自动机**，单次扫描 O(文本长度) 完成全词库匹配，千级词库高频提交无 CPU 尖刺；词库 60s 内存缓存，增删改即时失效。

## 采集中心

- 规则：列表页 URL（`{page}` 占位翻页）+ CSS 选择器（列表链接/标题/正文/摘要/封面）+ 清洗选择器
- 执行：任务中心异步（进度/取消/明细），URL 级去重（重复标记 skipped）
- 安全：SSRF 防护（内网白名单 `CMS_COLLECT_SSRF_ALLOWLIST`）
- 图片本地化：远程图片下载转存文件中心并替换 src（每篇 10 张、单张 5MB 上限）
- 入库：`autoPublish` 开启直接发布，否则进草稿箱

## 页面搭建

区块 JSON 装配式页面（默认 `/p/{slug}/`，isHome 可接管站点首页），6 种区块：hero / richtext / image / content-list / columns / **widget-ref**（引用「页面部件」，部件内容变化时定向刷新引用页面，见 [渲染与静态化](./static-and-render#页面部件与主题插槽)）。区块 `richtext` HTML 由服务端净化；`hero.image/buttonUrl`、`image.src/linkUrl` 和手工部件 URL 按字段使用素材地址或 CMS link policy（安全站内路径、已解析的 `entity:` 引用或允许的 http(s) 等协议），不能把任意协议字符串写入公开页面。

**content-list 取数**：按栏目（留空取全站）或**按标签跨栏目聚合**（选择站点标签后优先于栏目条件——专题页典型场景，如防汛专题聚合要闻/政策/通知多个栏目的同标签内容），配合取数模式（最新/推荐/热门）与条数（1-20）。

**自定义访问路径**：页面可设 `path` 覆盖默认的 `/p/{slug}/`，支持 `about`（→ `/about/`）、`about.html`、多级 `zh/about` 等形态。入库前归一为「无前后斜杠、无 `/index.html`」，使 URL 生成、静态产物路径与前台路由查表共用同一 key。保存时拦截三类冲突：系统保留首段（`p` / `tag` / `interaction` / `search` / `preview` / `api` / `assets`）与 `robots.txt`、`sitemap.xml`、`rss.xml`；站点内已被其他页面占用；与本站栏目路径相同（栏目侧有对称校验，批量建栏目时遇冲突自动改名而非报错）。改 `path` 或 `slug` 时按变更前路径删除旧产物，不留可访问的孤儿页面。

搭建器：

- 区块卡片**原生拖拽排序**（保留上移/下移按钮做键盘可达性兜底）
- SideSheet 底部**内嵌 iframe 实时预览**，保存后自动刷新，可新窗口打开
- `cms_page_block_acls` 以 `pageId + blockId + user|role + subjectId` 授权。平台超管旁路；无 ACL 时继承页面编辑权限，配置任一 ACL 后 fail-closed。
- 页面详情返回每个区块的 `canManage/aclConfigured/disabledReason`。页面更新与 ACL 设置先锁站点，再在事务内重读页面和启用角色授权；无权区块内容与其相对顺序必须不变，但允许删除排在其前面的有权区块。新区块仍要求页面编辑权限，设置 ACL 独立要求 `cms:page:acl`。
- 展示条件仅 `always/guest/member/dateRange`。所有条件区块都由服务端按当前会话与时间过滤，绝不先输出再用 CSS 隐藏；为避免静态产物跨时间边界泄露，含 guest/member/dateRange 条件的页面统一标记为 dynamic。可选会员认证同时校验 JWT、JTI 黑名单、Redis 会话和会员状态，任一失败按游客。

## 友链

名称/URL/Logo/排序，可归入**友链分组**（`cms_friend_link_groups`：名称 + 稳定标识 code + 排序 + 启停），主题按组分块渲染页脚；未分组友链归入 `code` 为空的默认组。分组删除后组内友链自动转为未分组，不会连带删除。权限 `cms:link:*`。

## 表单验证与验证码

- 字段支持文本长度、RE2-compatible 规则、邮箱、手机号、URL、数字范围及字段级自定义错误提示；自定义规则由服务端 `re2js` 线性时间引擎编译执行，`(a+)+$` 等表达式不会触发回溯型 ReDoS。浏览器约束仅用于体验，服务端始终重新验证。
- 表单验证码策略支持继承站点、关闭、算术题与 Cloudflare Turnstile。Turnstile 固定调用官方验证地址并通过统一 `http-client` 启用 SSRF 防护、禁止重定向和超时。
- Turnstile Secret 为 write-only：API 仅返回掩码，空串/掩码保留原值，显式 `null` 清除。
