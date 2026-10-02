/**
 * 内置只读主库元数据（表/列清单，脱敏），供报表可视化建模与 AI NL2SQL 共用。
 * 敏感表/列（凭据、密钥、会话等）统一在此过滤。
 */
import { sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db';
import { config } from '../config';
import { currentUser } from './context';
import { isPlatformAdmin } from './tenant';
import type { ReportMetaColumn } from '@arcbase/shared/report';

/** 敏感表：含凭据/密钥/会话等，不对建模与 AI 上下文暴露 */
const SENSITIVE_TABLE_RE = /(^|_)(password|secret|token|tokens|session|sessions|credential|oauth|sso|api_keys?|sms_config|email_config|ai_provider|file_storage|provider_config)s?($|_)/i;
const SENSITIVE_TABLES = new Set([
  'users', 'ai_provider_configs', 'oauth2_clients', 'api_tokens', 'file_storage_configs',
  'email_configs', 'sms_configs', 'user_ai_configs', 'report_datasources',
]);
/** 敏感列：即便所在表暴露，也不返回这些列 */
export const SENSITIVE_COLUMN_RE = /(password|secret|token|api_?key|client_secret|salt|private_key|access_key|refresh_token)/i;

export function isSensitiveTable(table: string): boolean {
  return SENSITIVE_TABLES.has(table) || SENSITIVE_TABLE_RE.test(table);
}

const CACHE_TTL_MS = 5 * 60_000;
let metaCache: { byTable: Map<string, ReportMetaColumn[]>; expire: number } | null = null;

/**
 * 读取 public schema 全部表/列（列级脱敏 + 5 分钟缓存）。
 *
 * 默认过滤敏感表；`forceIncludeTables` 可放行指定敏感表（仍剔除敏感列）——
 * 供 ChatBI 数据集上下文使用：数据集 SQL 已通过治理审核，其引用的表（如 users）
 * 需要暴露列结构供 NL2SQL 生成查询，密码/密钥等敏感列仍然不可见。
 */
export async function loadSchemaMeta(opts?: { forceIncludeTables?: Iterable<string> }): Promise<Map<string, ReportMetaColumn[]>> {
  if (config.multiTenantMode && !isPlatformAdmin(currentUser())) {
    throw new HTTPException(403, { message: '多租户模式下仅平台超级管理员可读取内置主库元数据' });
  }
  if (!metaCache || metaCache.expire <= Date.now()) {
    const rows = (await db.execute(sql.raw(
      `SELECT table_name, column_name, data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name NOT LIKE 'drizzle%'
       ORDER BY table_name, ordinal_position`,
    ))) as unknown as { table_name: string; column_name: string; data_type: string }[];
    // 缓存全部表（列已脱敏），敏感表过滤在返回视图做，便于 forceIncludeTables 精准放行
    const byTable = new Map<string, ReportMetaColumn[]>();
    for (const r of rows ?? []) {
      if (SENSITIVE_COLUMN_RE.test(r.column_name)) continue;
      if (!byTable.has(r.table_name)) byTable.set(r.table_name, []);
      byTable.get(r.table_name)!.push({ name: r.column_name, type: r.data_type });
    }
    metaCache = { byTable, expire: Date.now() + CACHE_TTL_MS };
  }
  const force = new Set([...(opts?.forceIncludeTables ?? [])].map((t) => t.split('.').at(-1)!.toLowerCase()));
  const view = new Map<string, ReportMetaColumn[]>();
  for (const [table, columns] of metaCache.byTable) {
    if (isSensitiveTable(table) && !force.has(table.toLowerCase())) continue;
    view.set(table, columns);
  }
  return view;
}

/** 可视化建模：可用表清单 */
export async function listMetaTables(): Promise<string[]> {
  const byTable = await loadSchemaMeta();
  return [...byTable.keys()].sort((a, b) => a.localeCompare(b));
}

/** 可视化建模：某表列清单（表不存在/敏感 → 404） */
export async function listMetaColumns(table: string): Promise<ReportMetaColumn[]> {
  const byTable = await loadSchemaMeta();
  const cols = byTable.get(table);
  if (!cols) throw new HTTPException(404, { message: '表不存在或不可访问' });
  return cols;
}
