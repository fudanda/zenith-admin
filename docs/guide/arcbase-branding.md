# ArcBase 更名与升级兼容

本次统一界面名称、Logo、favicon、npm 工作区、Go SDK、CLI、生成器、示例、构建与交付配置。管理台继续使用原 React Router / Semi UI 页面；API 路径、权限码、菜单、业务字段、账号和授权不变。

## 新名称

| 原名称 | 当前名称 |
| --- | --- |
| Zenith Admin | ArcBase |
| `@zenith/*` | `@arcbase/*` |
| `ZenithAdmin` 与相关公开类型 | `ArcBaseAdmin` 与相关公开类型 |
| `github.com/fudanda/zenith-admin/backend` | `github.com/fudanda/arcbase/backend` |
| Go 包 `zenith` | `arcbase` |
| `backend/cmd/zenith`、`zenith.exe` | `backend/cmd/arcbase`、`arcbase.exe` |
| `create-zenith` | `create-arcbase` |
| 新项目 `zenith.project.json`、`vendor/zenith` | `arcbase.project.json`、`vendor/arcbase` |
| `ZENITH_*` | `ARCBASE_*` |

重新执行 `npm install` 更新工作区链接。宿主代码改用 `@arcbase/admin` 的 `ArcBaseAdmin` 及对应类型、样式入口。Go 宿主改用新模块路径；当前通过随包 SDK 与本地 `replace` 交付，并未声明远程模块或 npm 包已发布。Git 远程与本地工作目录仍使用已有地址，仓库名与产品名独立。

## 已有安装

- CLI 优先读取明确设置的 `ARCBASE_*`，未设置时兼容同名 `ZENITH_*`；明确设置为空也不会回退旧值。开发 Go 包装脚本同样归一化旧变量。连接、密码、上传目录及 S3 加密密钥的值保持原样。
- 新登录写入 `arcbase_session`，原 `zenith_session` 按原有效期继续认证；新 Cookie 优先。登录轮换及退出清除旧 Cookie，退出仍撤销数据库会话。写请求 CSRF 与 Cookie 安全属性保持。
- 新 API Key 使用 `arc_` 前缀；旧 `zen_` 密钥继续按数据库摘要、权限、撤销及有效期校验。客户端同时接受两种格式。
- 当前部署的 `zenith:{deploymentId}:` 浏览器数据迁移到 `arcbase:{deploymentId}:`，已有新值优先；其他部署与宿主数据不会迁移或清理。
- `zenith_schema_versions`、`zenith_host_module_versions` 与已发布迁移保持原样，管理员密码摘要、实体 ID 和授权不变。Ent 代码重新生成，但不产生更名数据库迁移。
- S3 密文保留原加密关联标识，现有凭据无需重新配置。新备份使用 `ARCBASE_STORAGE_KEY`；恢复兼容旧备份中的 `ZENITH_STORAGE_KEY`，备份格式与校验保持。
- `create-arcbase module` 可识别旧 `zenith.project.json`。对旧项目保留旧 SDK / npm 命名生成模块，不混入新包，也不覆盖已有业务文件；新项目全部使用 ArcBase。

原 MIT 许可、作者版权、历史变更记录及作为来源的上游链接保留。

## 验证

运行类型、包边界、lint、契约生成与漂移检查、Go 和前端测试、生产构建、独立 tarball 安装、项目生成及 PostgreSQL / SQLite 页面验收。兼容测试覆盖旧环境、Cookie、API Key、浏览器偏好、备份和旧生成项目。
