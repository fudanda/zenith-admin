# 异常日志（服务端异常）

服务端异常与前端错误监控共用同一套 **Issue 模型**（`error_groups` / `error_events`）：一条异常按指纹归入分组，
分组承载处理状态、级别、指派、备注、告警规则与数据保留。「数据分析 → 错误监控」看浏览器端（`source = web_admin / web_member`），
「系统设置 → 系统监控 → 异常日志」看服务端（`source = server`）。没有新表：接口需要什么、谁抛了什么，都落在同一处。

实现位于 `packages/server/src/lib/error-tracking/`，页面契约为 `@arcbase/shared/platform` 的 `exceptionLogContract`（`/api/exception-logs`）。

## 采集点

| 来源 | errorType | 位置 | 说明 |
| --- | --- | --- | --- |
| HTTP 处理链 | `server_exception` | `app.onError` | 非 `HTTPException` 与 `status ≥ 500` 的异常；4xx 业务失败不记。响应体带 `requestId`，用户可凭号报障 |
| 任务中心 | `job_failure` | `lib/task-center/runner.ts` | 每次尝试失败一条：可重试失败 `warning`，终态失败 `error`；带任务类型 / id / attempt / maxAttempts、提交时的 traceId 与创建人 |
| 定时作业 | `cron_failure` | `lib/pg-boss-scheduler.ts` | 系统调度任务与业务定时任务失败（含超时） |
| 领域事件 | `event_failure` | 三条事件总线 | 订阅者 handler 抛错（事件名 + eventId） |
| 进程崩溃 | `process_crash` | `services/platform/crash-report.service.ts` | 重启后读崩溃哨兵补录，`level = fatal` |
| 日志兜底网 | `logged_error` | `lib/logger.ts` → `setLoggedErrorSink` | `logger.error / fatal` 携带 `Error` 对象的写入点自动进入；覆盖全库「已捕获但只打日志」的失败 |

业务代码通常**不需要**做任何事：`catch (err) { logger.error('[x] …', err) }` 已被兜底网覆盖。需要结构化上下文
（外部系统、作业 id、显式分组）时显式调用：

```ts
import { captureException } from '../lib/error-tracking';

captureException(err, {
  kind: 'logged_error',                 // 缺省 server_exception
  level: 'warning',                     // 缺省按 kind 推断
  message: '[sms] 供应商回调解析失败',    // 拼在异常消息前，参与分组
  job: { type: 'sms:callback', id: callbackId, final: true },
  extra: { provider },                  // 进 context.extra
  fingerprint: ['sms-callback', provider], // 显式分组，跳过按堆栈计算
});
```

同一个 `Error` 对象只会被记一次（对象上打符号标记），显式采集与兜底网不会重复。

## 采集器（reporter）保障

「记录异常」不能成为第二个故障，采集器只做同步 O(1) 的归一化 / 指纹 / 入队，落库由定时 flush 批量完成：

| 机制 | 行为 |
| --- | --- |
| 有界缓冲 | 500 条上限，溢出直接丢弃并计数；50 条或 1 秒触发 flush，一次事务最多写 100 条 |
| 单指纹闸 | 每分钟 `perIssuePerMinute`（默认 60）条保存详情，超出只累加分组次数（count-only） |
| 全局闸 | 每分钟 `globalPerMinute`（默认 600）条；新指纹的首个事件不受全局闸约束 |
| 熔断 | 连续 3 次落库失败（多半是数据库不可用）暂停 30 秒，只走进程日志 |
| 内建过滤 | `HTTPException < 500`、`OAuth2Error`、客户端中断（`ECONNRESET` 等）、优雅停机期间不记；`force: true` 可强制 |
| 忽略规则 | 设置里的正则命中即不记 |
| 设置刷新 | 每次 flush 异步刷新运行时设置；读不到沿用上一份（首次为 schema 默认值），设置不可读不会丢异常 |

运行状态可在页面「采集器状态」或 `GET /api/exception-logs/reporter-status` 查看（进程内计数器，多副本时为应答节点的值）。

## 指纹（分组）规则

`environment | errorType | errorName | 归一化消息 | 前 3 个应用内帧`

- 消息归一：数字 / UUID / 十六进制 → 占位符；引号内字面量保留（PG 约束名、列名是区分问题的关键）
- 应用内帧：过滤 `node_modules` / `node:internal`，去行列号，路径相对到 `src/` 或 `dist/`——部署改动不影响分组；
  一个应用帧都没有时退回前两帧
- 不含租户（同一 bug 多租户触发是一个 Issue，受影响租户走 `affectedTenantId` 分布）、不含路由（同一根因跨接口不拆组，路由只做筛选）
- 已解决的分组再次出现自动回到 `unresolved`（回归）

## 请求快照与脱敏

`server_exception` 事件的 `context.request` 含方法、URL、路由模板、状态、白名单请求头（`content-type` / `user-agent` / `referer` /
`x-request-id` / `x-forwarded-for` 等，凭证类根本不进快照）、query / params 与非 GET 请求体：

- 请求体复用 hono 校验器已解析的缓存，不二次读流；按 `lib/sanitize.ts` 的内置敏感字段 + 设置里 `request.redactKeys` 打码，超过 `request.bodyMaxBytes` 截断
- `request.captureBody = false` 时不记录请求体

## 隔离与权限

- 服务端事件与分组 `tenantId = null`（归平台），发生时请求所属租户记在 `affectedTenantId`
- 契约 `exceptionLogContract` 全部操作 `platformOnly: 'multi-tenant'`：多租户部署下仅平台超管可见；权限码
  `system:exception-log:list` / `system:exception-log:manage`
- 前端错误监控的全部查询 / 处理 / 清理恒定排除 `source = 'server'`，租户管理员持有 `monitor:error:*` 也看不到服务端堆栈
- 服务端告警规则固定 `source = 'server'`、平台级；前端错误页只管理浏览器端规则

## 运行时设置

模块 `errorTracking`（`/api/settings/error-tracking`，通用设置页可编辑，热更新）：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 关闭后异常只写进程日志 |
| `captureLoggedErrors` | `true` | 是否启用 `logger.error / fatal` 兜底网 |
| `perIssuePerMinute` / `globalPerMinute` | 60 / 600 | 风暴闸值 |
| `request.captureBody` / `bodyMaxBytes` / `redactKeys` | `true` / 4096 / `[]` | 请求快照 |
| `ignorePatterns` | `[]` | 忽略正则 |

## 告警与保留

- 告警规则（`error_alert_rules`）新增 `source` 维度；服务端事件落库后由 `registerErrorAlertListener()` 实时评估，cron 保底；
  通知事件 `ops.error.alert`
- 数据保留策略 `error_events` 同时覆盖前端与服务端事件（默认 90 天），清理后回收无引用分组

## 关联排障

事件带 `traceId`（= 请求的 `X-Request-Id`，任务 / 事件继承提交时的链路）：

- 日志查看器按 `reqId` 检索同一请求的全部日志行
- 链路追踪 `GET /api/trace/{traceId}` 聚合请求 / 作业 / 事件 / 通知 / 任务时间线
- 前端接口错误（`http_error`）上报时携带失败响应的 `X-Request-Id`，两侧详情互相跳转
