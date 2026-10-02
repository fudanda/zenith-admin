/**
 * 阶段 2：统一对比轴（breakdown 维度 / 群组对比）的服务端实现。
 *
 * 漏斗、留存、下钻共用本模块，保证「图上看到的序列」与「下钻到的人群」用同一套
 * 维度归一规则——两处各写一份的话，`utm_source` 为空的用户会在图里算进「未知」、
 * 在下钻里却查不到，数字对不上且极难排查。
 *
 * 安全设计：维度全部来自 shared 白名单枚举，映射到固定列或固定 SQL 表达式，
 * 不接受任意列名，也不做字符串拼接。
 */
import { inArray, sql, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { AnalyticsBreakdownDimension, AnalyticsComparison } from '@arcbase/shared/analytics';
import {
  ANALYTICS_BREAKDOWN_DIMENSION_LABELS,
  ANALYTICS_BREAKDOWN_MAX_SERIES,
  ANALYTICS_BREAKDOWN_OTHER_LABEL,
  ANALYTICS_BREAKDOWN_UNKNOWN_LABEL,
  ANALYTICS_SERIES_OVERALL_KEY,
  ANALYTICS_SERIES_OVERALL_LABEL,
} from '@arcbase/shared/analytics';
import { userEvents } from '../../db/schema';
import { ensureSegmentAccessible, segmentMemberDistinctIdSubquery } from './analytics-segments.service';

/**
 * 从 referrer URL 中取出主机名。
 * `substring(... from '^[a-zA-Z]+://([^/?#]+)')` 只截取协议与首个 `/` 之间的部分，
 * 非法/空 referrer 返回 NULL，交由外层归一为「未知/直接访问」。
 */
export const REFERRER_HOST_SQL = sql<string | null>`substring(${userEvents.referrer} from '^[a-zA-Z]+://([^/?#]+)')`;

/**
 * 获客渠道派生规则（优先级自上而下）：
 *  1. utm_medium 显式声明付费/邮件/社交 → 以声明为准（广告投放的权威口径）
 *  2. 有 utm_source 但 medium 未声明 → 按 source 域名特征归类
 *  3. 无 UTM 但有 referrer → 按 referrer 域名特征归类（自然搜索 / 社交 / 外部引荐）
 *  4. 无 UTM 无 referrer → 直接访问
 *
 * 只用 `~*`（大小写不敏感正则）匹配固定字面量模式，不引用用户输入。
 */
export const ACQUISITION_CHANNEL_SQL = sql<string>`
  CASE
    WHEN ${userEvents.utmMedium} ~* '^(cpc|ppc|paid|cpm|cpv|display|banner)$' THEN 'paid_search'
    WHEN ${userEvents.utmMedium} ~* '^(email|newsletter|edm)$' THEN 'email'
    WHEN ${userEvents.utmMedium} ~* '^(social|social-network|social-media|sm)$' THEN 'social'
    WHEN ${userEvents.utmMedium} ~* '^(organic|seo)$' THEN 'organic_search'
    WHEN ${userEvents.utmMedium} ~* '^(referral|affiliate|partner)$' THEN 'referral'
    WHEN ${userEvents.utmSource} ~* '(google|bing|baidu|sogou|duckduckgo|yandex)' THEN 'organic_search'
    WHEN ${userEvents.utmSource} ~* '(weibo|wechat|weixin|douyin|twitter|facebook|linkedin|zhihu|xiaohongshu)' THEN 'social'
    WHEN ${userEvents.utmSource} IS NOT NULL AND ${userEvents.utmSource} <> '' THEN 'referral'
    WHEN ${userEvents.referrer} ~* '://[^/]*(google|bing|baidu|sogou|duckduckgo|yandex)' THEN 'organic_search'
    WHEN ${userEvents.referrer} ~* '://[^/]*(weibo|wechat|weixin|douyin|twitter|facebook|linkedin|zhihu|xiaohongshu)' THEN 'social'
    WHEN ${userEvents.referrer} IS NOT NULL AND ${userEvents.referrer} <> '' THEN 'referral'
    ELSE 'direct'
  END
`;

/** 维度 → SQL 取值表达式（NULL 表示空值，由外层归一为「未知」） */
export function breakdownValueSql(dimension: AnalyticsBreakdownDimension): SQL<string | null> {
  switch (dimension) {
    case 'browser': return sql`${userEvents.browser}`;
    case 'os': return sql`${userEvents.os}`;
    case 'deviceType': return sql`${userEvents.deviceType}::text`;
    case 'region': return sql`${userEvents.region}`;
    case 'country': return sql`${userEvents.country}`;
    case 'source': return sql`${userEvents.source}::text`;
    case 'appId': return sql`${userEvents.appId}`;
    case 'environment': return sql`${userEvents.environment}`;
    case 'channel': return ACQUISITION_CHANNEL_SQL as SQL<string | null>;
    case 'utmSource': return sql`${userEvents.utmSource}`;
    case 'utmMedium': return sql`${userEvents.utmMedium}`;
    case 'utmCampaign': return sql`${userEvents.utmCampaign}`;
    case 'referrerHost': return REFERRER_HOST_SQL;
    default:
      throw new HTTPException(400, { message: `不支持的拆分维度：${dimension as string}` });
  }
}

/**
 * 维度取值 → 精确匹配条件。
 * 空字符串 key 代表「空值」，必须同时匹配 NULL 与 ''：仅用 `= ''` 会漏掉 NULL 行，
 * 下钻人数就会比图上的「未知」少一截。
 */
export function breakdownValueCondition(dimension: AnalyticsBreakdownDimension, value: string): SQL {
  const expr = breakdownValueSql(dimension);
  if (value === '') return sql`(${expr} IS NULL OR ${expr} = '')`;
  return sql`${expr} = ${value}`;
}

export function breakdownLabel(dimension: AnalyticsBreakdownDimension, value: string): string {
  if (value !== '') return value;
  // 来源类维度的空值语义是「没有来源」，即直接访问，而不是「不知道」
  return dimension === 'referrerHost' || dimension === 'utmSource' || dimension === 'utmMedium' || dimension === 'utmCampaign'
    ? '直接访问'
    : ANALYTICS_BREAKDOWN_UNKNOWN_LABEL;
}

export function breakdownDimensionLabel(dimension: AnalyticsBreakdownDimension): string {
  return ANALYTICS_BREAKDOWN_DIMENSION_LABELS[dimension] ?? dimension;
}

/** 解析后的一条序列：key/label 用于展示，`condition` 是该序列的额外 WHERE 约束 */
export interface ResolvedSeries {
  key: string;
  label: string;
  /** 该序列在事件表上的过滤条件；`undefined` 表示不额外约束（全部用户） */
  condition?: SQL;
}

export const OVERALL_SERIES: ResolvedSeries = {
  key: ANALYTICS_SERIES_OVERALL_KEY,
  label: ANALYTICS_SERIES_OVERALL_LABEL,
};

/** `dimension` 序列 key 的前缀约定；`segments` 用 `segment:{id}` 以免与维度值冲突 */
export function segmentSeriesKey(segmentId: number): string {
  return `segment:${segmentId}`;
}

/** 长尾合并序列的稳定 key（维度真实取值不可能是这个字符串） */
export const ANALYTICS_BREAKDOWN_OTHER_KEY = '__other__';

/**
 * 把对比轴解析成一组序列。
 *
 * - `none`：单条「全部用户」序列
 * - `dimension`：先按该维度统计取值（`topValues` 按量级降序返回），保留前 N 条，
 *   剩余长尾合并为「其他」——不合并的话各序列之和小于总量，看图的人会以为丢了数据
 * - `segments`：逐个校验分群归属后生成 `distinct_id IN (分群成员)` 条件
 */
export async function resolveComparisonSeries(
  comparison: AnalyticsComparison | undefined,
  topValues: (dimension: AnalyticsBreakdownDimension) => Promise<string[]>,
  segmentNameOf: (segmentId: number) => Promise<string>,
): Promise<ResolvedSeries[]> {
  if (!comparison || comparison.type === 'none') return [OVERALL_SERIES];

  if (comparison.type === 'dimension') {
    const { dimension } = comparison;
    const all = await topValues(dimension);
    if (all.length === 0) return [OVERALL_SERIES];
    const head = all.slice(0, ANALYTICS_BREAKDOWN_MAX_SERIES);
    const series: ResolvedSeries[] = head.map((value) => ({
      key: value,
      label: breakdownLabel(dimension, value),
      condition: breakdownValueCondition(dimension, value),
    }));
    if (all.length > head.length) {
      const expr = breakdownValueSql(dimension);
      series.push({
        key: ANALYTICS_BREAKDOWN_OTHER_KEY,
        label: ANALYTICS_BREAKDOWN_OTHER_LABEL,
        // COALESCE 到 '' 后再取反，才能把 NULL 行正确归入长尾（NULL NOT IN (...) 恒为 NULL）
        condition: sql`COALESCE(${expr}, '') NOT IN (${sql.join(head.map((v) => sql`${v}`), sql`, `)})`,
      });
    }
    return series;
  }

  const series: ResolvedSeries[] = [];
  for (const segmentId of comparison.segmentIds) {
    await ensureSegmentAccessible(segmentId);
    series.push({
      key: segmentSeriesKey(segmentId),
      label: await segmentNameOf(segmentId),
      condition: inArray(userEvents.distinctId, segmentMemberDistinctIdSubquery(segmentId)),
    });
  }
  return series;
}

/** 从已解析的序列里按 key 定位（下钻用）；找不到时回落到首条，保证下钻不会空手而归 */
export function findSeriesByKey(series: ResolvedSeries[], key: string | undefined): ResolvedSeries {
  if (!key) return series[0];
  return series.find((s) => s.key === key) ?? series[0];
}
