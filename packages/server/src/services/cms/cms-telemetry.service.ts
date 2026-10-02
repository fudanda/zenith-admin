import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type * as z from 'zod';
import { HTTPException } from 'hono/http-exception';
import { cmsTelemetrySettingsSchema, type cmsTelemetryBatchSchema, type CmsTelemetryEvent, type CmsTelemetryPageContext, type CmsTelemetryResult } from '@arcbase/shared/cms';
import type { TrackEventInput } from '@arcbase/shared/analytics';
import { db } from '../../db';
import { cmsSites, cmsDeployments, cmsTelemetryReceipts, userEvents, analyticsSites, cmsContents } from '../../db/schema';
import { config } from '../../config';
import redis from '../../lib/redis';
import { batchInsertEvents } from '../analytics/analytics.service';
import { assertSiteAccess, ensureCmsSiteExists, enableSiteAnalytics, updateCmsSite } from './cms-sites.service';
import { verifyCmsTelemetryPageToken } from './cms-telemetry-context';
import { detectDeviceType } from './cms-stats.service';

export async function isCmsTelemetryEnabled(siteId: number): Promise<boolean> {
  const [site] = await db.select({ settings: cmsSites.settings, status: cmsSites.status }).from(cmsSites).where(eq(cmsSites.id, siteId)).limit(1);
  const settings = site?.settings?.telemetry as { enabled?: boolean; schemaVersion?: number } | undefined;
  return site?.status === 'enabled' && settings?.enabled === true && settings.schemaVersion === 2;
}

/** Capture and publish like every other public setting; disabling also stops cached pages immediately. */
export async function configureCmsTelemetry(siteId: number, input: z.output<typeof cmsTelemetrySettingsSchema>) {
  await assertSiteAccess(siteId);
  if (input.enabled) await enableSiteAnalytics(siteId);
  const site = await ensureCmsSiteExists(siteId);
  await updateCmsSite(siteId, { settings: { ...site.settings, telemetry: { ...input, schemaVersion: 2 } } });
  return { siteId, ...input, requiresPublication: true as const };
}

function referrerHost(value: string | undefined, origin: string | null): string | null {
  if (!value) return null;
  try { const host = new URL(value).host.toLowerCase(); return origin && new URL(origin).host.toLowerCase() === host ? null : host.slice(0, 255); } catch { return null; }
}
function pageProperties(page: CmsTelemetryPageContext, event: CmsTelemetryEvent, origin: string | null) {
  return {
    ...event.properties, cmsSchemaVersion: 2, trustedCms: true, environment: page.environment, cmsSiteId: page.siteId,
    visitorId: event.visitorId, sessionId: event.sessionId, pageViewId: event.pageViewId,
    contentId: page.contentId, channelId: page.channelId, revisionId: page.revisionId,
    contentType: page.contentType, contentTitle: page.contentTitle, channelName: page.channelName, author: page.author,
    releaseId: page.releaseId, deploymentId: page.deploymentId, pageType: page.pageType, canonicalPath: page.canonicalPath,
    referrerHost: referrerHost(event.referrer, origin), receivedAt: new Date().toISOString(),
    ...(page.search ? { keyword: page.search.keyword, resultCount: page.search.resultCount } : {}),
  };
}

async function receipt(siteId: number, accepted: number, rejected: number, duplicates: number, reason?: string) {
  await db.insert(cmsTelemetryReceipts).values({ siteId, accepted, rejected, duplicates, reason });
}

/** Only this endpoint can stamp trusted CMS facts; generic analytics ingest strips the reserved stamp. */
export async function collectCmsTelemetry(input: z.output<typeof cmsTelemetryBatchSchema>, request: { ip: string; userAgent: string; origin: string | null; host: string }) : Promise<CmsTelemetryResult> {
  const page = verifyCmsTelemetryPageToken(input.contextToken);
  if (!page) throw new HTTPException(403, { message: '页面采集上下文无效，请刷新页面' });
  return (async () => {
    const [site] = await db.select().from(cmsSites).where(eq(cmsSites.id, page.siteId)).limit(1);
    if (!site) throw new HTTPException(404, { message: '站点不存在' });
    const reject = async (reason: string): Promise<CmsTelemetryResult> => {
      await receipt(site.id, 0, input.events.length, 0, reason);
      return { acceptedEventIds: [], rejectedEventIds: input.events.map((e) => e.eventId), duplicates: 0, reason };
    };
    if (!await isCmsTelemetryEnabled(site.id)) return reject('disabled');
    if (page.environment !== 'live') return reject('preview');
    if (detectDeviceType(request.userAgent) === 'bot') return reject('bot');
    if (site.settings?.analyticsSiteKey !== page.siteKey) return reject('configuration_changed');
    const [app] = await db.select().from(analyticsSites).where(and(eq(analyticsSites.siteKey, page.siteKey), isNull(analyticsSites.tenantId))).limit(1);
    if (!app || app.status !== 'enabled') return reject('disabled');
    // Same-origin collector requests are required; allowedOrigins additionally fences custom domains.
    if (!request.origin) return reject('origin_missing');
    const originHost = (() => { try { return new URL(request.origin).hostname.toLowerCase(); } catch { return ''; } })();
    const domains = [site.domain, ...(site.aliasDomains ?? [])].filter((v): v is string => !!v).map(v => v.split(':')[0].toLowerCase());
    const localDevelopment = config.isDevelopment && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(originHost);
    const sameOriginHost = originHost === request.host.replace(/:\d+$/, '').toLowerCase();
    if (!localDevelopment && !sameOriginHost && !domains.includes(originHost)) return reject('origin_rejected');
    if (!page.deploymentId || !page.releaseId) return reject('unpublished');
    const [deployment] = await db.select({ id: cmsDeployments.id, releaseId: cmsDeployments.releaseId, activatedAt: cmsDeployments.activatedAt }).from(cmsDeployments)
      .where(and(eq(cmsDeployments.id, page.deploymentId), eq(cmsDeployments.siteId, site.id))).limit(1);
    if (!deployment?.activatedAt || deployment.releaseId !== page.releaseId) return reject('unpublished');
    if (page.contentId) {
      const [content] = await db.select({ id: cmsContents.id }).from(cmsContents).where(and(eq(cmsContents.id, page.contentId), eq(cmsContents.siteId, site.id), isNull(cmsContents.deletedAt))).limit(1);
      if (!content) return reject('content_unavailable');
    }
    const key = `${config.redis.keyPrefix}cms:telemetry:${site.id}:${request.ip}`;
    const n = await redis.incr(key);
    if (n === 1) await redis.expire(key, 60);
    if (n > 300) throw new HTTPException(429, { message: '采集请求过于频繁，请稍后重试' });

    const now = Date.now();
    const unique = [...new Map(input.events.map(event => [event.eventId, event])).values()];
    const valid = unique.filter((event) => {
      const age = now - Date.parse(event.occurredAt);
      if (age > 86_400_000 || age < -300_000) return false;
      if (event.name === 'cms.search' && (!page.search?.keyword || page.search.page !== 1)) return false;
      if ((event.name === 'cms.read' || event.name === 'cms.engagement') && !event.pageViewId) return false;
      if (event.name === 'cms.read' && (!page.contentId || (event.properties.activeMs ?? 0) < 10000 || (event.properties.scrollDepth ?? 0) < 50)) return false;
      return true;
    });
    if (!valid.length) return reject('invalid_event');
    // Content/placement target IDs remain dimensions, never replacements for the signed page identity.
    const events: TrackEventInput[] = valid.map((event) => ({
      eventId: event.eventId, eventType: event.name === 'cms.page_view' ? 'page_view' : event.name === 'cms.engagement' ? 'page_leave' : 'custom',
      eventName: event.name, anonymousId: event.visitorId, sessionId: event.sessionId, pagePath: page.canonicalPath,
      pageTitle: page.contentTitle ?? site.name, ts: Date.parse(event.occurredAt), properties: pageProperties(page, event, request.origin),
      durationMs: event.properties.activeMs, scrollDepth: event.properties.scrollDepth, source: 'web_member', appId: app.appId,
      environment: config.isDevelopment ? 'development' : 'production', sdkVersion: 'cms-2',
      screenW: event.screenW, screenH: event.screenH, language: event.language,
      referrer: event.referrer, utmSource: event.utm?.source, utmMedium: event.utm?.medium, utmCampaign: event.utm?.campaign, utmTerm: event.utm?.term, utmContent: event.utm?.content,
    }));
    let insertedIds: string[] = [];
    let rejectedReason: string | undefined;
    await batchInsertEvents(events, { ip: request.ip, ua: request.userAgent, origin: request.origin, siteKey: page.siteKey, cmsVerified: true, onRejected: reason => { rejectedReason = reason; }, onInserted: ids => { insertedIds = ids; }, onPersisted: async (tx, ids) => {
      if (!page.contentId) return;
      const fresh = new Set(ids);
      const count = valid.filter(event => event.name === 'cms.page_view' && fresh.has(event.eventId)).length;
      if (count) await tx.execute(sql`update public.cms_contents set view_count=view_count+${count} where id=${page.contentId} and site_id=${site.id}`);
    } });
    if (rejectedReason === 'quota_exceeded') { await receipt(site.id, 0, input.events.length, 0, rejectedReason); throw new HTTPException(429, { message: '站点采集额度暂时用尽' }); }
    const accepted = await db.select({ eventId: userEvents.eventId, properties: userEvents.properties, name: userEvents.eventName }).from(userEvents)
      .where(and(eq(userEvents.appId, app.appId), or(inArray(userEvents.eventId, valid.map(e => e.eventId)), and(eq(userEvents.eventName, 'cms.page_view'),
        inArray(sql<string>`${userEvents.properties}->>'pageViewId'`, valid.filter(e => e.name === 'cms.page_view').map(e => e.pageViewId)))),
      sql`${userEvents.properties}->>'cmsSiteId'=${String(site.id)}`, sql`${userEvents.properties}->>'trustedCms'='true'`));
    const acceptedEventIds = valid.filter(event => accepted.some(row => row.eventId === event.eventId || (event.name === 'cms.page_view' && row.name === 'cms.page_view'
      && row.properties?.pageViewId === event.pageViewId && row.properties?.visitorId === event.visitorId && row.properties?.sessionId === event.sessionId
      && row.properties?.contentId === page.contentId && row.properties?.deploymentId === page.deploymentId))).map(event => event.eventId);
    const acceptedSet = new Set(acceptedEventIds);
    const rejectedEventIds = input.events.filter(e => !acceptedSet.has(e.eventId)).map(e => e.eventId);
    const duplicates = acceptedEventIds.length - insertedIds.length + input.events.length - unique.length;
    await receipt(site.id, insertedIds.length, rejectedEventIds.length, Math.max(0, duplicates), rejectedEventIds.length ? 'invalid_or_governed' : undefined);
    return { acceptedEventIds, rejectedEventIds, duplicates: Math.max(0, duplicates) };
  })();
}
