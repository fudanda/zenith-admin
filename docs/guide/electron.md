# Electron 桌面客户端

`packages/electron` 将 Web 前端打包为桌面客户端。桌面壳不包含后端业务逻辑，仍通过 API 地址访问已部署的 ArcBase Server。

## 构建要求

| 依赖 | 要求 |
| --- | --- |
| Node.js | 24.x |
| npm 依赖 | 在仓库根目录完成 `npm install` / `npm ci` |
| 平台构建工具 | 按 electron-builder 对 Windows / macOS / Linux 的要求准备 |

## 开发调试

```bash
npm run dev:electron
```

该脚本执行 `packages/electron` 的 `dev`：编译 Electron TypeScript、启动 `@arcbase/web`、监听主进程 TypeScript，并在 `http://localhost:5373` 可用后打开窗口。后端需另行启动 `npm run dev:server` 或由前端环境变量指向远程 API。

## 构建命令

```bash
npm run build:electron         # 当前平台
npm run build:electron:win     # Windows NSIS，x64
npm run build:electron:mac     # macOS dmg + zip，x64 / arm64
npm run build:electron:linux   # Linux AppImage，x64
```

根脚本先以 `VITE_ELECTRON=true` 构建 `@arcbase/web`，再运行 `@arcbase/electron` 的平台构建。Electron 模式下 Web 使用相对资源路径与 `HashRouter`，适配 `file://` 协议。

::: warning Windows shell
根 `build:electron*` 脚本使用 Unix `env VITE_ELECTRON=true`。Windows 默认 cmd 不支持该写法，请使用 Git Bash 或 WSL。
:::

## 产物位置

产物输出到根目录 `dist/electron/`。当前 electron-builder 配置：

| 平台 | 目标 |
| --- | --- |
| Windows | NSIS 安装包，x64 |
| macOS | dmg + zip，x64 / arm64 |
| Linux | AppImage，x64 |

Web 静态文件作为 `extraResources` 复制到安装包资源目录的 `web/` 下。

## 主进程与 preload

| 文件 | 职责 |
| --- | --- |
| `packages/electron/src/main.ts` | 创建 1280×800 主窗口、外链用系统浏览器打开、窗口状态同步、应用生命周期 |
| `packages/electron/src/preload.ts` | 通过 `contextBridge` 暴露窗口控制、`isElectron` 与在线升级手动检查 API（不暴露任何可改写更新服务器的接口） |
| `packages/electron/src/updater.ts` | 双层在线升级、deviceId、灰度命中、下载校验、安装回执 |
| `packages/electron/src/safe-unzip.ts` | 热更包安全解压（拒绝符号链接 / 越界路径，限制体积） |

安全配置：`contextIsolation=true`、`nodeIntegration=false`、`webSecurity=true`。

## 在线升级

桌面端对接服务端「系统设置 → 应用版本」，固定 appKey 为 `arcbase-desktop`。打包运行后，启动 15 秒执行首次检查，随后每 4 小时检查一次；也支持渲染进程手动触发检查（`electronAPI.updater.check()`）。

| 更新类型 | 制品 kind | 行为 |
| --- | --- | --- |
| Web 热更新 | `hotupdate` | 下载 zip → SHA256 校验（**必需**，缺失即拒绝）→ 安全解压到 `userData/web-updates/{version}` → 提示重载；壳版本不变 |
| 壳全量更新 | `installer` + `metadata` | `electron-updater` 使用 generic feed 下载安装包 / blockmap / latest.yml，提示重启安装；Windows 下按 `publisherName` 校验 Authenticode 签名 |
| 外链更新 | `external` | 打开系统浏览器访问外部下载地址（仅 `https`） |

### 更新服务器地址（信任根）

更新服务器地址决定客户端从哪里取代码，**渲染进程不能改写**——页面内任意脚本（XSS、恶意富文本）都不能把客户端指向别的服务器。来源优先级：

1. `userData/update-config.json`（本机运维覆盖），例如 `{ "serverUrl": "https://admin.example.com", "channel": "stable" }`
2. 打包时写入 `package.json` 的 `updateServer`：构建前设置环境变量 `ARCBASE_UPDATE_SERVER=https://admin.example.com`，由 `electron-builder.config.js` 通过 `extraMetadata` 注入
3. 仅开发模式（未打包）：环境变量 `ARCBASE_UPDATE_SERVER`

地址必须为 `https`（未打包时允许 `http://localhost`），带用户名、查询串或片段的地址一律忽略；制品下载地址必须与更新服务器同源。渠道支持 `stable`、`beta`、`internal`。客户端首次运行生成匿名 `deviceId`，检查、下载与回执请求都会携带该标识，用于灰度分桶与统计。

### 制品完整性

- 热更包：服务端上传制品时自动计算 SHA256，客户端下载后必须匹配；解压使用自带的 `safe-unzip`（基于 `yauzl`），拒绝符号链接与非常规文件条目、`..` / 绝对路径 / 反斜杠，落地路径必须位于目标目录内，并限制条目数与解压体积。原 `extract-zip` 存在符号链接越界写入漏洞（GHSA-jmr9-qjv8-65gv，上游无修复），已移除。
- 安装包：`electron-updater` 只有在配置了 `win.publisherName` 时才校验安装包签名。生产发布必须使用代码签名证书（`CSC_LINK` / `CSC_KEY_PASSWORD` 等 electron-builder 变量）并设置 `ARCBASE_WIN_PUBLISHER_NAME=<证书 Subject Name>`，否则壳更新链路退化为仅依赖 HTTPS 信任服务器。

### 顶层导航与外链

主窗口 `will-navigate` 只允许停留在应用自身（打包后的 `file://` 资源、开发期 Vite dev server）；其它导航被拦截，`http(s)` / `mailto` 交给系统浏览器，`file:` 等协议直接丢弃。`window.open` 同样只放行 `http(s)` / `mailto` 到 `shell.openExternal`，杜绝 UNC 路径触发 NTLM 凭据外泄或启动可执行文件。

## 发布客户端版本

1. 设置 `ARCBASE_UPDATE_SERVER`（与代码签名相关变量），执行对应平台构建命令。
2. 在「系统设置 → 应用版本」维护应用、版本与制品。
3. 仅 Web 前端变化时上传 Electron 模式构建的 `packages/web/dist` zip，类型选 `热更新包`。
4. 壳能力变化时上传安装包、blockmap 与 latest.yml 等 electron-builder 产物，类型选 `安装包` / `元数据`。
5. 发布版本，可配置灰度比例；升级看板记录检查、下载、安装成功与失败事件。

macOS 自动更新依赖签名与 zip feed，按 electron-builder 平台要求处理证书与公证。
