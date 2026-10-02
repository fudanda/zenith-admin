# 独立 ArcBase 宿主

先配置 `.env`，再执行 npm install、npm run build、npm run db:migrate、npm run db:seed、npm run init-admin -- admin、npm start。打开 http://127.0.0.1:8080/dash/。

生产运行 backend/bin/arcbase（Windows 为 arcbase.exe），由外部环境提供 `.env` 中的配置。HTTPS 部署关闭 ARCBASE_INSECURE_COOKIES。不要把 .env、storage 或 backups 提交到 Git。

模块 schema 和 API 契约位于 frontend/modules，Go 业务位于 backend/modules，Ent schema 位于 backend/ent/schema；npm run generate 生成契约、OpenAPI、Go DTO 和 Ent。npm run check:contracts 检查生成漂移。修改已发布 SQL 会被拒绝，新增字段应追加模块版本迁移。

前端入口已加载 Semi UI 的 react19-adapter；宿主自己的页面使用 Modal.confirm 等命令式组件时需保留此导入。

恢复管理员：npm run reset-admin -- admin --generate --credentials-file .env。该文件只记录凭据，启动不会改写账号密码。

离线备份：停止服务后 npm run backup -- backups/snapshot；PostgreSQL 需 pg_dump/pg_restore，或追加 --pg-container NAME。备份包含数据库、本地/已管理 S3 文件、暂存目录及存储密钥，请妥善保管。

恢复：连接新的空 PostgreSQL 数据库或新的 SQLite 路径，执行 npm run restore -- backups/snapshot --files-root storage-restored --env-file restored.env。备份包含 S3 时需明确 --s3-to-local，恢复到新本地目录，不覆盖现有 Bucket。使用 restored.env 的路径和密钥启动恢复实例。连接切换不会自动搬迁数据。
