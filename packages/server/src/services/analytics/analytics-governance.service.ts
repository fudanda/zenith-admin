/**
 * 行为中心阶段 1：Tracking Plan 治理闭环。
 *
 * 职责：
 * - 60s 缓存事件字典（Tracking Plan：status/strictMode/propertySchema）与租户级事件覆盖（禁用名单）；
 * - 采集入口按事件名做治理判定：全局 blocked / 租户 disabled 直接拒收；按 propertySchema 做
 *   required/type/enum 校验，strictMode 下有 schema 问题的事件整体拒收，非 strict 下仅记录问题、事件继续；
 * - 所有不匹配统一写 analytics_event_quality_daily 日聚合（tenantId 用 0 哨兵存全局/无租户），
 *   sample 字段只落脱敏后的 {key, expected, actualType} 元信息，不落原始属性值；
 * - 治理记录全程 best-effort：任何失败都不能阻断正常采集。
 */
import { eq, sql } from 'drizzle-orm';
import { db } from '../../db';
import { analyticsEventMeta, analyticsEventOverrides, analyticsEventQualityDaily } from '../../db/schema';
import type { AnalyticsEventMetaStatus, AnalyticsEventPropertyDef, AnalyticsEventPropertyType, AnalyticsQualityIssueType, TrackEventInput } from '@arcbase/shared/analytics';
import { formatDate } from '../../lib/datetime';

const CACHE_TTL_MS = 60_000;

interface MetaCacheEntry {
  status: AnalyticsEventMetaStatus;
  strictMode: boolean;
  propertySchema: AnalyticsEventPropertyDef[] | null;
}

interface GovernanceCache {
  fetchedAt: number;
  metaByName: Map<string, MetaCacheEntry>;
  /** 禁用覆盖集合，key 为 `${tenantId}:${eventName}`（tenantId 用 0 表示无租户） */
  disabledOverrides: Set<string>;
}

let cache: GovernanceCache | null = null;
let loadingPromise: Promise<GovernanceCache> | null = null;

async function loadCacheUncached(): Promise<GovernanceCache> {
  const [metaRows, overrideRows] = await Promise.all([
    db.select({
      eventName: analyticsEventMeta.eventName,
      status: analyticsEventMeta.status,
      strictMode: analyticsEventMeta.strictMode,
      propertySchema: analyticsEventMeta.propertySchema,
    }).from(analyticsEventMeta),
    db.select({
      tenantId: analyticsEventOverrides.tenantId,
      eventName: analyticsEventOverrides.eventName,
    }).from(analyticsEventOverrides).where(eq(analyticsEventOverrides.status, 'disabled')),
  ]);
  const metaByName = new Map<string, MetaCacheEntry>();
  for (const row of metaRows) {
    metaByName.set(row.eventName, { status: row.status, strictMode: row.strictMode, propertySchema: row.propertySchema ?? null });
  }
  const disabledOverrides = new Set<string>();
  for (const row of overrideRows) disabledOverrides.add(`${row.tenantId}:${row.eventName}`);
  return { fetchedAt: Date.now(), metaByName, disabledOverrides };
}

async function loadGovernanceCache(): Promise<GovernanceCache> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) return cache;
  // 并发请求共享同一次加载，避免缓存过期瞬间的惊群查询
  if (!loadingPromise) {
    loadingPromise = loadCacheUncached()
      .then((loaded) => { cache = loaded; return loaded; })
      .finally(() => { loadingPromise = null; });
  }
  return loadingPromise;
}

/** 事件字典 / 租户覆盖变更后立即失效缓存，供对应 service 在写操作后调用。 */
export function invalidateGovernanceCache(): void {
  cache = null;
  loadingPromise = null;
}

// ─── propertySchema 校验 ──────────────────────────────────────────────────────
export interface SchemaIssue {
  key: string;
  issueType: 'missing_required' | 'type_mismatch' | 'invalid_enum';
  /** 期望约束的脱敏描述（属性类型 / 枚举取值列表，均来自 schema 定义本身，非用户数据） */
  expected: string;
  /** 实际值的类型标签（非原始值），避免落 PII */
  actualType: string;
}

function actualTypeLabel(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function typeMatches(type: AnalyticsEventPropertyType, value: unknown): boolean {
  switch (type) {
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'boolean': return typeof value === 'boolean';
    case 'datetime':
      return value instanceof Date || (typeof value === 'string' && !Number.isNaN(Date.parse(value)));
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'array':
      return Array.isArray(value);
    default:
      return true;
  }
}

/** 依据 Tracking Plan propertySchema 校验事件属性，返回脱敏问题列表（未知属性始终放行）。 */
export function detectSchemaIssues(
  propertySchema: AnalyticsEventPropertyDef[] | null | undefined,
  properties: Record<string, unknown> | null | undefined,
): SchemaIssue[] {
  if (!propertySchema || propertySchema.length === 0) return [];
  const issues: SchemaIssue[] = [];
  const props = properties ?? {};
  for (const def of propertySchema) {
    const present = Object.prototype.hasOwnProperty.call(props, def.key) && props[def.key] !== undefined && props[def.key] !== null;
    if (!present) {
      if (def.required) issues.push({ key: def.key, issueType: 'missing_required', expected: def.type, actualType: 'undefined' });
      continue;
    }
    const value = props[def.key];
    if (!typeMatches(def.type, value)) {
      issues.push({ key: def.key, issueType: 'type_mismatch', expected: def.type, actualType: actualTypeLabel(value) });
      continue;
    }
    if (def.type === 'string' && def.enumValues && def.enumValues.length > 0 && !def.enumValues.includes(value as string)) {
      issues.push({ key: def.key, issueType: 'invalid_enum', expected: def.enumValues.join('|'), actualType: 'string' });
    }
  }
  return issues;
}

// ─── 质量日聚合 upsert（best-effort，count += n，sample 只存脱敏元信息）────────────
const MAX_SAMPLE_ISSUES = 5;

async function upsertQualityDaily(
  tenantId: number,
  eventName: string,
  issueType: AnalyticsQualityIssueType,
  sampleIssues: SchemaIssue[],
): Promise<void> {
  const statDate = formatDate(new Date());
  const now = new Date();
  const sample = sampleIssues.length > 0
    ? { issues: sampleIssues.slice(0, MAX_SAMPLE_ISSUES).map(({ key, expected, actualType }) => ({ key, expected, actualType })) }
    : null;
  await db
    .insert(analyticsEventQualityDaily)
    .values({ tenantId, statDate, eventName, issueType, count: 1, sample, lastSeenAt: now })
    .onConflictDoUpdate({
      target: [
        analyticsEventQualityDaily.tenantId,
        analyticsEventQualityDaily.statDate,
        analyticsEventQualityDaily.eventName,
        analyticsEventQualityDaily.issueType,
      ],
      set: {
        count: sql`${analyticsEventQualityDaily.count} + 1`,
        lastSeenAt: now,
        ...(sample ? { sample } : {}),
      },
    });
}

/** 记录一次质量问题（不区分事件是否落库，供 disabled/schema 拒收与 fresh 事件后置计数复用）。 */
export async function recordQualityIssue(tenantId: number, eventName: string, issueType: AnalyticsQualityIssueType): Promise<void> {
  await upsertQualityDaily(tenantId, eventName, issueType, []);
}

/** 按 issueType 分组记录一批 schema 问题（同一事件内同类型问题合并为 1 次计数）。 */
export async function recordSchemaIssues(tenantId: number, eventName: string, issues: SchemaIssue[]): Promise<void> {
  const grouped = new Map<SchemaIssue['issueType'], SchemaIssue[]>();
  for (const issue of issues) {
    const list = grouped.get(issue.issueType) ?? [];
    list.push(issue);
    grouped.set(issue.issueType, list);
  }
  await Promise.all([...grouped.entries()].map(([issueType, list]) => upsertQualityDaily(tenantId, eventName, issueType, list)));
}

// ─── 拒收事件的 eventId 去重缓存（避免客户端重放/重试重复计数）───────────────────
const REJECTED_DEDUP_MAX = 5000;
const rejectedEventIds = new Map<string, number>();

function shouldRecordRejected(eventId: string | undefined): boolean {
  if (!eventId) return true; // 无稳定 ID（历史离线队列）：无法去重，按 best-effort 直接记录
  if (rejectedEventIds.has(eventId)) return false;
  if (rejectedEventIds.size >= REJECTED_DEDUP_MAX) {
    const oldestKey = rejectedEventIds.keys().next().value;
    if (oldestKey !== undefined) rejectedEventIds.delete(oldestKey);
  }
  rejectedEventIds.set(eventId, Date.now());
  return true;
}

/** 仅供测试重置内部去重缓存状态。 */
export function __resetGovernanceStateForTest(): void {
  cache = null;
  loadingPromise = null;
  rejectedEventIds.clear();
}

// ─── 采集入口治理评估 ─────────────────────────────────────────────────────────
export interface PendingSchemaIssue {
  event: TrackEventInput;
  tenantId: number;
  issues: SchemaIssue[];
}

export interface GovernanceOutcome {
  /** 通过治理的事件（保留原始引用，供后续 eventId 赋值/去重复用同一对象）。 */
  accepted: TrackEventInput[];
  /** 非阻断模式下命中 schema 问题但仍被接收的事件；仅应在事件真正新鲜落库后计数，避免重放重复计数。 */
  pendingSchemaIssues: PendingSchemaIssue[];
}

/**
 * 治理过滤：必须在生成兜底 eventId / 开启采集事务之前调用，使用客户端原始 eventId（可能为空）
 * 作为拒收去重 key —— 落库前生成的兜底 UUID 每次重试都不同，无法用于去重。
 */
export async function evaluateEvents(events: TrackEventInput[], tenantId: number | null): Promise<GovernanceOutcome> {
  if (events.length === 0) return { accepted: [], pendingSchemaIssues: [] };
  const scopeTenantId = tenantId ?? 0;
  let loaded: GovernanceCache;
  try {
    loaded = await loadGovernanceCache();
  } catch {
    // 治理缓存加载失败：降级为全部放行，保证正常采集不被治理故障阻断
    return { accepted: events, pendingSchemaIssues: [] };
  }

  const accepted: TrackEventInput[] = [];
  const pendingSchemaIssues: PendingSchemaIssue[] = [];
  for (const event of events) {
    if (!event.eventName) { accepted.push(event); continue; }
    const meta = loaded.metaByName.get(event.eventName);
    if (meta?.status === 'blocked') continue; // 全局屏蔽：静默拒收，无质量记录（与既有行为一致）

    if (loaded.disabledOverrides.has(`${scopeTenantId}:${event.eventName}`)) {
      if (shouldRecordRejected(event.eventId)) {
        void recordQualityIssue(scopeTenantId, event.eventName, 'event_disabled').catch(() => { /* best-effort，不阻断采集 */ });
      }
      continue;
    }

    const issues = meta ? detectSchemaIssues(meta.propertySchema, event.properties) : [];
    if (issues.length > 0 && meta?.strictMode) {
      if (shouldRecordRejected(event.eventId)) {
        void recordSchemaIssues(scopeTenantId, event.eventName, issues).catch(() => { /* best-effort，不阻断采集 */ });
      }
      continue;
    }

    accepted.push(event);
    if (issues.length > 0) pendingSchemaIssues.push({ event, tenantId: scopeTenantId, issues });
  }
  return { accepted, pendingSchemaIssues };
}

export type { AnalyticsEventPropertyType };
