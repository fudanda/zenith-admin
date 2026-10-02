# 分享 / 订阅 / 嵌入 / 协作

仪表盘建好后，可以对外公开分享、定时推送摘要、嵌入到项目其它模块，并支持团队评论协作。

## 公开分享链接

为仪表盘生成无需登录即可访问的链接，适合对外展示或大屏投屏。

### 使用步骤

1. 在仪表盘列表/详情打开「分享」管理。
2. 「创建分享链接」，可选：
   - **访问密码**：设置后访客需输入密码（至少 8 位，bcrypt 加盐存储）。
   - **有效期**：7 / 30 / 90 天或永久，默认 **30 天**（不默认永久，降低长期暴露面）。
   - **最大访问次数**：达到次数后链接自动失效（留空 = 不限）。
   - **IP / CIDR 白名单**：限定允许访问的来源 IP 或网段（如 `10.0.0.0/8`），白名单外拒绝。
   - **启用 / 停用**：随时开关。
3. 复制链接（形如 `/public/report/{token}`）、**iframe 嵌入代码**或扫码用**二维码**对外发布。

公开页只读渲染，复用与预览一致的渲染器；筛选器可交互且**筛选状态实时同步到 URL**（复制链接即可分享当前筛选视图），并支持导出 PNG。取数走专用公开通道，不暴露后台接口与敏感字段。

### 访问会话（两步验证）

带密码的链接采用**访问会话**机制：访客先在密码页提交密码（`POST /api/report/public/dashboards/{token}/access`），验证通过后签发短期**访问会话凭证**，后续取数请求凭该凭证放行——密码本身只传输一次，不随每次取数反复提交。

### 安全防护

- **接口限流**：公开通道 `/api/report/public/*` 内置按 IP 限流（默认 120 次/分钟，可在「限流规则」中调整 `report_public_share` 规则），防滥用与密码爆破。
- **访问日志**：每次公开访问（含密码错误 / 链接过期 / IP 拒绝的尝试）记录 IP 与时间，分享管理里可查看每条链接的累计访问次数与最近访问时间。
- **数据最小化**：公开取数按组件显式字段配置裁剪列，未被引用的列不出公网；无法识别字段时返回空列而不是回退全量。表格需显式选择公开展示列。
- **受限数据集保护**：使用行级权限、`${__*}` 系统变量或必填运行参数的数据集不能匿名分享，避免公开访问绕过登录上下文。

## 定时订阅推送

按 Cron 周期把仪表盘关键指标摘要推送给指定人。在「报表中心 → 订阅推送」（`/report/subscriptions`）管理。

| 字段 | 说明 |
|------|------|
| 仪表盘 | 要推送的仪表盘 |
| Cron | 推送周期表达式（如 `0 0 9 * * *` 每天 9 点） |
| 时区 | IANA 时区（默认 `Asia/Shanghai`），Cron 按该时区解释 |
| 错过策略 | 服务停机错过推送点后的处理：`跳过`（skip）或`补跑一次`（fire_once） |
| 通道 | 邮件 / 站内信 / Webhook（企微、钉钉机器人或通用 JSON 端点，可多选） |
| 收件人 | 邮箱（逗号分隔）；站内信推给创建者；Webhook 需填机器人地址 |

调度器按 `nextRunAt` 巡检到期订阅，自动取数生成「指标卡摘要 + 查看链接」并下发；摘要自动附带**较上期推送的环比趋势**（↑ / ↓ / 持平），邮件通道以 HTML 格式发送。也可在列表手动「立即推送」一次（走任务中心异步任务）。

列表「最近投递」列展示上次推送状态（成功 / 部分成功 / 失败），点开**投递历史**可查看每次推送的各通道明细；失败重试与状态语义见[取数运行时与可靠投递](./runtime-governance#可靠投递)。

订阅在创建及每次执行前都会检查仪表盘数据集；包含行级权限、`${__*}` 系统变量或必填参数的仪表盘不能进入无身份定时推送。摘要来自仪表盘中的 KPI 组件；KPI 绑定的数据集字段和对比字段必须存在且可数值化，`count` 聚合不要求字段。

## 跨模块嵌入 `<ReportEmbed>`

任意仪表盘可用一行组件嵌入项目内的其它页面（如在订单模块内嵌销售看板），把宿主上下文作为筛选值注入：

```tsx
import { ReportEmbed } from '@/components/ReportEmbed';

// 把当前部门作为筛选器值注入报表
<ReportEmbed
  dashboardId={5}
  filterValues={{ f_dept: deptId }}
  height={420}
/>
```

| 属性 | 说明 |
|------|------|
| `dashboardId` | 要嵌入的仪表盘 ID |
| `embedToken` | 外部匿名嵌入令牌；传入后走公开嵌入接口，不使用后台登录态 |
| `filterValues` | 外部注入的筛选器值（按 filterId），受控时始终以 props 为真值 |
| `showFilters` | 是否显示内置筛选栏（默认隐藏，由宿主控制） |
| `readOnly` | 禁止筛选器、ref 和 `postMessage` 修改筛选值 |
| `interceptDrilldown` | 触发回调后阻止默认钻取跳转 |
| `allowedOrigins` | 精确宿主 origin 白名单；默认读取仪表盘配置，再回退同源 |
| `onLoad` / `onError` | 嵌入仪表盘加载成功或失败时回调 |
| `onFilterChange` | 筛选值变化时回调；受控模式下仅通知宿主，不覆盖 props |
| `onWidgetClick` / `onDrilldown` | 组件点击与钻取事件回调 |
| `height` / `className` / `style` | 容器高度、样式类与内联样式 |

嵌入为只读渲染，复用同一套组件与取数逻辑；大屏画布仪表盘按比例自适应容器。组件 ref 暴露 `refresh()`、`setFilter()`、`resetFilters()`、`getState()` 与 `exportPng()`，便于宿主主动刷新、设置筛选和导出图片。

登录内嵌按 `dashboardId` 读取发布态；外部宿主使用 scoped embed token：

- `GET /api/report/dashboards/{id}/embed-tokens`：Token 列表；
- `POST /api/report/dashboards/{id}/embed-tokens`：创建限定仪表盘、来源与有效期的 Token，并可声明**允许外部修改的筛选器**（`allowedFilterIds`）与**固定筛选值**（`fixedFilters`，宿主不可覆盖）；
- `POST /api/report/dashboards/embed-tokens/{embedTokenId}/revoke`：立即吊销；
- `GET /api/report/public/embed/{token}`、`POST /api/report/public/embed/{token}/data`：匿名读取发布快照和取数。

Token 不放在日志或 URL 查询参数中，不等价于后台 JWT；吊销、过期、来源不匹配或仪表盘未发布时拒绝访问。移动端自动切换为单列阅读模式，使用同一发布快照、组件权限和查询预算。

### Embed SDK 命令与事件协议

桥接协议固定为：

```ts
type Command = {
  channel: 'arcbase.report.embed';
  version: '1.0';
  type: 'command';
  command: 'setFilter' | 'setFilters' | 'resetFilters' | 'refresh' | 'getState' | 'exportPng';
  requestId?: string;
  payload?: unknown;
};
```

子页面事件使用相同 `channel/version`，`type: 'event'`，事件名为 `loaded`、`error`、`filterChanged`、`widgetClicked`、`drilldown`、`exportReady`、`stateSnapshot`。`requestId` 将命令和 `stateSnapshot` / `exportReady` / `error` 关联。

来源规则是强制安全边界：

- 仅接受 `messageEvent.source === window.parent` 且 `messageEvent.origin` 精确命中白名单的消息；
- 白名单只接受无用户信息、query、hash 和额外 path 的 `http/https` origin；`*` 和非法值被丢弃，空白名单会禁用桥；
- 回复始终指定精确 `targetOrigin`，不广播到 `*`；
- 消息最大 64 KiB，字段必须严格匹配协议；filterId 必须存在且不超过 64 字符，最多 100 个筛选器，单个字符串值不超过 2,048 字符；
- 协议版本不匹配、未知命令或只读模式修改时返回 `error`；受控 `filterValues` 始终以宿主 props 为真值，命令不能覆盖。升级协议需发布新版本，不解释未知字段。

宿主 iframe 示例：

```ts
const reportOrigin = 'https://reports.example.com';
const frame = document.querySelector<HTMLIFrameElement>('#report-frame')!;

frame.addEventListener('load', () => {
  frame.contentWindow?.postMessage({
    channel: 'arcbase.report.embed',
    version: '1.0',
    type: 'command',
    command: 'setFilter',
    requestId: 'dept-42',
    payload: { filterId: 'f_dept', value: 42 },
  }, reportOrigin);
});

window.addEventListener('message', (event) => {
  if (event.origin !== reportOrigin || event.source !== frame.contentWindow) return;
  const message = event.data;
  if (message?.channel !== 'arcbase.report.embed' || message?.version !== '1.0') return;
  if (message.type === 'event' && message.event === 'drilldown') {
    // 由宿主执行经过自身路由白名单验证的跳转。
  }
});
```

## 评论协作

仪表盘预览页提供「评论」侧栏，支持团队对报表留言批注并闭环处置：

- **楼中楼回复**：可对某条评论回复，形成两级讨论串；
- **解决 / 重新打开**：评论可标记「已解决」（记录处理人与时间），也可重新打开——适合「报表数字有疑问 → 修正后关闭」的协作闭环；解决权限属于评论作者或管理员；
- **编辑 / 删除**：可编辑自己的评论；可删除自己的评论（管理员可删任意评论）。

需要 `report:dashboard:list` 权限即可参与评论。

## 导出汇总

| 导出 | 入口 | 格式 |
|------|------|------|
| 仪表盘整屏 | 仪表盘预览页 | PNG 图片 |
| 数据集数据 | 数据集列表行 | Excel / CSV（接入导出中心） |
| 打印报表 | 打印报表 | Excel / PDF / Word（接入导出中心） / 浏览器打印 |

## 权限速查

| 操作 | 权限码 |
|------|--------|
| 创建/管理公开分享 | `report:dashboard:update` |
| 评论 | `report:dashboard:list` |
| 订阅查看 | `report:subscription:list` |
| 订阅新增 | `report:subscription:create` |
| 订阅编辑 / 批量启停 / 立即推送 | `report:subscription:update` |
| 订阅删除 | `report:subscription:delete` |
