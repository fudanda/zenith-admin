/**
 * 短链跳转链路：Redis 缓存寻址 + 异步点击落库。
 *
 * 跳转路径以 Redis 为一级缓存（TTL 兜底 + 写操作主动失效）；
 * 点击明细与计数在响应后异步写入，不阻塞跳转。
 */
import { createHash } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { ANALYTICS_EVENT_NAMES } from '@arcbase/shared/analytics';
import { db } from '../../db';
import { shortLinks, shortLinkClicks, type ShortLinkRow } from '../../db/schema';
import redis from '../../lib/redis';
import logger from '../../lib/logger';
import { parseClientEnv, lookupIpGeo } from '../../lib/analytics-helpers';
import { trackServerEvent } from '../analytics/analytics-server-events.service';

const CACHE_PREFIX = 'shortlink:code:';
const CACHE_TTL_SECONDS = 300;
/** 负缓存标记：短码不存在也缓存，防止穷举打穿数据库 */
const CACHE_NULL = '__null__';

export interface ResolvedShortLink {
  id: number;
  code: string;
  /** 已拼装 UTM 参数的最终跳转地址 */
  finalUrl: string;
  redirectType: '302' | '301';
  status: 'enabled' | 'disabled';
  expiresAtMs: number | null;
  maxVisits: number | null;
  password: string | null;
  bizType: string;
  bizRef: string | null;
  tenantId: number | null;
}

/** 目标地址追加 UTM 参数（原地址已有同名参数时不覆盖） */
export function buildFinalUrl(row: ShortLinkRow): string {
  const utm: Array<[string, string | null]> = [
    ['utm_source', row.utmSource],
    ['utm_medium', row.utmMedium],
    ['utm_campaign', row.utmCampaign],
    ['utm_term', row.utmTerm],
    ['utm_content', row.utmContent],
  ];
  if (!utm.some(([, v]) => v)) return row.targetUrl;
  try {
    const url = new URL(row.targetUrl);
    for (const [key, value] of utm) {
      if (value && !url.searchParams.has(key)) url.searchParams.set(key, value);
    }
    return url.toString();
  } catch {
    return row.targetUrl;
  }
}

function toResolved(row: ShortLinkRow): ResolvedShortLink {
  return {
    id: row.id,
    code: row.code,
    finalUrl: buildFinalUrl(row),
    redirectType: row.redirectType,
    status: row.status,
    expiresAtMs: row.expiresAt ? row.expiresAt.getTime() : null,
    maxVisits: row.maxVisits ?? null,
    password: row.password ?? null,
    bizType: row.bizType,
    bizRef: row.bizRef ?? null,
    tenantId: row.tenantId ?? null,
  };
}

export async function resolveShortLink(code: string): Promise<ResolvedShortLink | null> {
  const cacheKey = `${CACHE_PREFIX}${code}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached === CACHE_NULL) return null;
    if (cached) return JSON.parse(cached) as ResolvedShortLink;
  } catch (err) {
    logger.warn(`[short-link] Redis 读取失败，回源数据库: ${(err as Error).message}`);
  }

  const [row] = await db.select().from(shortLinks).where(eq(shortLinks.code, code)).limit(1);
  const resolved = row ? toResolved(row) : null;
  try {
    await redis.setex(cacheKey, CACHE_TTL_SECONDS, resolved ? JSON.stringify(resolved) : CACHE_NULL);
  } catch {
    // 缓存写失败不影响跳转
  }
  return resolved;
}

/** 写操作（更新/禁用/删除）后主动失效缓存，保证编辑即生效 */
export async function invalidateShortLinkCache(code: string): Promise<void> {
  try {
    await redis.del(`${CACHE_PREFIX}${code}`);
  } catch (err) {
    logger.warn(`[short-link] 缓存失效失败（TTL ${CACHE_TTL_SECONDS}s 内兜底过期）: ${(err as Error).message}`);
  }
}

/** maxVisits 判定读取实时计数（仅设了上限的短链走这条路径） */
export async function getLiveVisitCount(linkId: number): Promise<number> {
  const [row] = await db
    .select({ totalPv: shortLinks.totalPv })
    .from(shortLinks)
    .where(eq(shortLinks.id, linkId))
    .limit(1);
  return row?.totalPv ?? 0;
}

export interface ClickContext {
  link: ResolvedShortLink;
  ip: string;
  ua: string;
  referer: string | null;
}

/**
 * 记录一次点击（响应后异步调用，不阻塞跳转）。
 * 爬虫流量落明细（isBot=true）但不计入 totalPv、统计口径与分析事件。
 */
export async function recordShortLinkClick(ctx: ClickContext): Promise<void> {
  const env = parseClientEnv(ctx.ua);
  const geo = lookupIpGeo(ctx.ip);
  const isBot = env.deviceType === 'bot';
  const visitorId = createHash('md5').update(`${ctx.ip}|${ctx.ua}`).digest('hex').slice(0, 32);

  await db.insert(shortLinkClicks).values({
    linkId: ctx.link.id,
    visitorId,
    ip: ctx.ip || null,
    country: geo.country,
    province: geo.region,
    city: geo.city,
    deviceType: env.deviceType,
    os: env.os,
    browser: env.browser,
    referer: ctx.referer ? ctx.referer.slice(0, 512) : null,
    isBot,
  });

  if (!isBot) {
    // 原生 SQL 递增计数：绕过 $onUpdate 与审计 Proxy，避免点击流量污染 updatedAt / updatedBy
    await db.execute(
      sql`UPDATE short_links SET total_pv = total_pv + 1, last_visit_at = now() WHERE id = ${ctx.link.id}`,
    );
    // 桥接为服务端语义事件：进入行为分析（fire-and-forget，内部吞错，不影响点击链路）
    trackServerEvent({
      eventName: ANALYTICS_EVENT_NAMES.shortLinkClicked,
      tenantId: ctx.link.tenantId,
      properties: {
        linkId: ctx.link.id,
        code: ctx.link.code,
        bizType: ctx.link.bizType,
        bizRef: ctx.link.bizRef,
        deviceType: env.deviceType,
        os: env.os,
        browser: env.browser,
        country: geo.country,
        province: geo.region,
        city: geo.city,
      },
    });
  }
}

/** 供路由 fire-and-forget 调用的安全包装 */
export function recordShortLinkClickSafe(ctx: ClickContext): void {
  void recordShortLinkClick(ctx).catch((err) => {
    logger.warn(`[short-link] 点击记录失败 linkId=${ctx.link.id}: ${(err as Error).message}`);
  });
}
