# App 推送

App 推送是通知中心的 `push` 渠道：业务事件经 `notify()` 统一派发，推送适配器把消息投递到移动 / 桌面客户端。国内安卓生态下进程被杀后只有系统级厂商通道可达，因此采用「聚合供应商」方案——服务端只对接极光（JPush）REST API，华为 / 小米 / OPPO / vivo / 荣耀厂商通道与 APNs 凭证全部配置在极光后台，服务端零感知。

事实来源以 `packages/server/src/lib/push-sender.ts`、`packages/server/src/lib/notification/adapters/push.adapter.ts`、`packages/server/src/services/messaging/push-configs.service.ts`、`packages/server/src/services/ops/client-devices.service.ts` 为准。

## 架构

```mermaid
flowchart LR
    subgraph Clients["客户端"]
        D["桌面端<br/>升级检查心跳自带 deviceId"]
        M["移动端<br/>集成极光 SDK 获取 registrationId"]
    end
    D -->|"check API 顺手 upsert"| CD[("client_devices<br/>统一设备中心")]
    M -->|"登录后绑定"| CD
    N["业务域 notify()"] --> DP["通知派发层<br/>偏好 / 免打扰 / 频控 / 留痕"]
    DP --> PA["push 渠道适配器"]
    PA -->|"按收件人查在活绑定设备"| CD
    PA --> J["极光 REST v3<br/>在线走长连,离线切厂商通道 / APNs"]
    PA --> L[("push_send_logs")]
```

| 层 | 位置 | 职责 |
| --- | --- | --- |
| 发送适配 | `lib/push-sender.ts` | 极光 REST v3（Basic Auth），单批上限 1000 设备自动分批；识别 1003/1011 无效 RegistrationID；provider 接口可插拔 |
| 渠道适配器 | `lib/notification/adapters/push.adapter.ts` | 收件人 → 在活绑定设备寻址（仅保留所属应用有启用凭证的设备），按应用分组各取凭证投递，成败按组回写发送记录 |
| 配置与记录 | `services/messaging/push-configs.service.ts`、`push-send-logs.service.ts` | 凭证管理（一对一挂应用、脱敏、APNs 环境）、测试发送、发送流水与统计、回执写回 |
| 统一设备中心 | `services/ops/client-devices.service.ts` | 设备档案 upsert、推送绑定 / 解绑、在活寻址、无效绑定清理、升级看板取数 |

## 凭证按应用绑定

推送凭证一对一挂应用（`push_configs.app_id` 唯一）——供应商侧凭证本就按 App 发放，不存在"全局默认配置"。派发时适配器按设备所属应用分组，各取各的凭证分别调用供应商；没有凭证的应用（如桌面端，厂商推送是移动 SDK 概念）其设备天然不可达，与"没绑邮箱"同语义按 `unreachable` 留痕。

部分应用组失败**不会**触发渠道级重投（重投会对已成功组重复推送），失败组已在发送记录留痕；全部组失败才按渠道失败上报，由 outbox 补投兜底。

## 统一设备中心

设备是一等公民：升级灰度、App 推送与在网统计共用一张 `client_devices` 表，锚点是客户端生成并持久化的匿名 `deviceId`。

三个写入口：

1. **升级检查心跳**：`GET /api/public/app-releases/check` 携带 `deviceId` 时自动 upsert 平台 / 架构 / 版本 / 活跃时间——桌面端零改动即被登记；
2. **登录绑定推送**：移动端集成推送 SDK 后，登录成功调绑定接口写入 `subjectType/subjectId + pushRegistrationId`；同一 `registrationId` 换机重装会自动从旧设备迁移；
3. **登出解绑**：清除绑定人，设备档案保留（无主体的设备对推送不可达）。

管理端入口：系统设置 → 应用版本 → **设备** Tab，支持按应用 / 平台 / 绑定人 / 推送绑定筛选、解绑推送与删除档案。

## 服务端 API

### 管理接口（登录 + 权限）

| 方法与路径 | 权限 | 说明 |
| --- | --- | --- |
| `GET/POST/PUT/DELETE /api/push-configs` | `system:push:*` | 推送配置 CRUD（一对一挂应用，重复创建报唯一冲突），`masterSecret` 编辑留空表示不更新 |
| `POST /api/push-configs/{id}/test` | `system:push:send` | 测试发送，直发指定 RegistrationID |
| `GET /api/push-send-logs` | `system:push-log:list` | 发送记录（状态 / 时间 / 关键字筛选，含送达 / 点击回执列） |
| `GET /api/push-send-logs/stats` | `system:push-log:list` | 记录页统计：窗口汇总（发送 / 成功 / 失败 / 送达 / 点击）+ 按日趋势 |
| `POST /api/notification-policies/test-fire` | `system:notify-policy:test` | 测试触发：以当前管理员为收件人真实派发一次事件（模板变量填示例值） |
| `GET /api/app-releases/devices` | `system:app-release:list` | 设备列表 |
| `PUT /api/app-releases/devices/{id}/unbind` | `system:app-release:update` | 强制解绑推送 |
| `DELETE /api/app-releases/devices/{id}` | `system:app-release:delete` | 删除设备档案 |

### 送达回执（公开回调）

`POST /api/public/push/callbacks/jpush` 接收极光送达 / 点击回执（在极光控制台配置回调地址后启用）。报文宽松解析：`data` 支持单事件或事件数组，事件含 `msg_id`、`type`（`received`/`0`=送达，`click`/`opened`/`1`=点击）、可选 `itime` 秒级时间戳。按 `(provider, providerMsgId)` 定位发送记录写回 `deliveryStatus/deliveredAt/clickedAt`——点击蕴含送达，重复回执幂等，未匹配事件静默忽略并恒返 200（避免供应商重试轰炸）。真实对接如启用回调验签，在该路由补 token/sign 校验。

### 无效设备自动清理

发送响应 `1003`（报文点名单个非法 RegistrationID）或 `1011`（整批目标无效）时，自动清除对应设备的推送绑定（设备档案保留，重新登录绑定即恢复）。测试发送与事件派发两条链路都会触发清理。

### 客户端绑定接口（登录态即可，无权限点）

| 方法与路径 | 认证 | 说明 |
| --- | --- | --- |
| `POST /api/push/devices` | 管理端 token | 绑定推送设备（移动审批等管理员身份客户端） |
| `DELETE /api/push/devices/{deviceId}` | 管理端 token | 登出解绑 |
| `POST /api/member/push/devices` | 会员会话 | 会员端绑定 |
| `DELETE /api/member/push/devices/{deviceId}` | 会员会话 | 会员端解绑 |

绑定请求体：

```json
{
  "app": "arcbase-mobile",
  "deviceId": "客户端持久化的匿名设备标识",
  "provider": "jpush",
  "registrationId": "极光 SDK 返回的 RegistrationID",
  "platform": "android",
  "deviceModel": "Xiaomi 15",
  "osVersion": "Android 15",
  "appVersion": "1.10.0",
  "pushEnabled": true
}
```

## 事件接入

`push` 已注册进通知渠道枚举，业务事件在 `availableChannels` 声明后即可被用户 / 管理员开启。首批开放：

| 事件 | 说明 |
| --- | --- |
| `workflow.task.created` | 收到新待办审批 |
| `workflow.task.urged` | 待办被催办 |
| `ops.monitor.alert` | 系统监控告警（必达） |
| `ops.error.alert` | 前端错误监控告警（必达） |

业务侧无需感知推送细节——`notify()` 派发时若收件人开启了 push 渠道且有在活绑定设备，适配器自动投递；无设备按 `unreachable` 留痕。需要覆盖推送标题或附加透传参数时使用 `channelOptions.push`：

```ts
await notify('workflow.task.created', {
  recipients,
  vars,
  link: `/approval/tasks/${task.id}`,   // 自动映射为推送点击跳转（extras.link）
  channelOptions: {
    push: { title: '待办提醒', extras: { taskId: String(task.id) } },
  },
});
```

## 运营群发

群发不是新的发送通道：活动只是「受众 × 渠道 × 文案」的载体，发送时经任务中心分批（500 人/批）调用 `notify()` 派发 hidden 事件 `messaging.broadcast`，渠道投递、用户免打扰与投递留痕全部复用通知派发层。

- **入口**：系统设置 → 通知管理 → **运营群发**（权限 `system:broadcast:*`）；
- **受众**：全体用户 / 全体会员 / 指定用户名单 / 指定会员名单（仅启用状态的主体，发送时快照）；
- **渠道**：站内信 / App 推送 / 邮件多选（映射派发层 `channelPolicy.only`；短信需模板参数，不开放给群发）；
- **幂等**：批次 `dedupeKey broadcast:{id}:batch:{n}`——任务断点重跑、自动重试不会重复入队；
- **状态机**：`draft → sending → sent`，任务取消 → `cancelled`，用尽重试 → `failed`；失败 / 取消 / 草稿可编辑后重新发送（编辑回到草稿）；
- **进度**：发送任务进入任务中心（类型 `messaging-broadcast`），列表页实时展示进度，逐收件人×渠道决策在通知策略 → 投递日志。

## 管理端配置流程

1. 在[极光控制台](https://www.jiguang.cn/)创建应用，厂商通道（华为 / 小米 / OPPO / vivo / 荣耀）与 APNs 证书按极光文档配置在极光后台；
2. 系统设置 → 通知管理 → **App 推送 → 推送配置**：选择所属应用（一对一），录入 AppKey / MasterSecret，选择 APNs 环境（开发 / 生产）；
3. 用「测试发送」直发一台真机的 RegistrationID 验证通道；
4. 系统设置 → 通知管理 → 通知策略：按需锁定 / 开放各事件的 App 推送渠道，用「测试触发」以自己为收件人验证完整链路；用户在个人偏好中自行开关；
5. 发送流水、失败原因与送达 / 点击回执在 **App 推送 → 推送记录** 查看（顶部有汇总统计与趋势），投递决策（含 `unreachable` / 频控 / 免打扰）在通知策略 → 投递日志。

## 客户端接入（移动端）

1. 集成极光 SDK（Android / iOS），初始化后获取 `RegistrationID`；
2. 登录成功后调用绑定接口上报（见上文请求体）；登出时调用解绑接口；
3. 通知点击事件读取 `extras.link`，在应用内路由跳转;
4. 用户在 App 设置中关闭推送时，重新绑定并传 `pushEnabled: false`（保留绑定但停止投递）。

## 数据保留

| 数据 | 策略 |
| --- | --- |
| `push_send_logs` | 默认保留 180 天（系统设置 → 数据保留可调） |
| `client_devices` | 按 `last_active_at` 裁剪 180 天不活跃设备；设备重新上线会自动重新登记 |
