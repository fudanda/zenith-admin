import { sql, type SQL } from 'drizzle-orm';
import type { QueryOutputOf } from '@arcbase/shared/core';
import { cmsStatContract, cmsStatRate, type CmsStatMetrics, type CmsStatOverview, type CmsStatOptions, type CmsStatQuality, type CmsStatReport, type CmsStatReportRow, type CmsStatScope } from '@arcbase/shared/cms';
import { readSnapshot } from '../../db';
import type { DbTransaction } from '../../db/types';
import { buildListResult } from '../../lib/list-query';
import { keywordCondition } from '../../lib/where-helpers';
import { assertSiteAccess, ensureCmsSiteExists } from './cms-sites.service';
import { assertAllCmsSiteChannelsAccess } from './cms-channels.service';
import { resolveCmsStatsWindow, type CmsStatsQuery } from './cms-stats-window';
import { cmsGenerationSchemaName } from './cms-generation-storage.service';

type ReportQuery = QueryOutputOf<typeof cmsStatContract.report>;
type Dimension = NonNullable<ReportQuery['dimension']>;
type SqlMetricRow = Record<keyof CmsStatMetrics, number | string> & { key: string; label: string; clickThroughs: number; readThroughs: number; searchClickThroughs: number };
const conversionNames = sql`('cms.form_complete','cms.vote_complete','cms.comment_complete','cms.follow_complete')`;
const property = (key: string) => sql`e.properties->>${key}`;
const textProperty = (key: string, fallback = '未标注') => sql`coalesce(nullif(${property(key)},''),${fallback})`;
const creditedProperty = (key: string) => sql`coalesce(nullif(${property(`origin${key[0].toUpperCase()}${key.slice(1)}`)},''),nullif(${property(key)},''))`;
const creditedContentId = creditedProperty('contentId');

export async function assertCmsStatisticsAccess(siteId: number) {
  await ensureCmsSiteExists(siteId); await assertSiteAccess(siteId); await assertAllCmsSiteChannelsAccess(siteId);
}

/** The containment predicate uses the existing JSONB GIN index and never accepts untrusted legacy events. */
export function cmsStatisticsWhere(q: CmsStatsQuery, scope: CmsStatScope): SQL {
  const fingerprint = { cmsSchemaVersion: 2, cmsSiteId: q.siteId, environment: 'live', trustedCms: true };
  return sql`e.tenant_id is null and e.properties @> ${JSON.stringify(fingerprint)}::jsonb
    and e.created_at >= ${scope.startTime}::timestamptz and e.created_at < ${scope.endTime}::timestamptz
    and coalesce((${property('receivedAt')})::timestamptz,e.created_at)<=${scope.watermark}::timestamptz
    and coalesce(e.device_type::text,'unknown') <> 'bot'
    ${q.contentId ? sql`and ${creditedContentId}=${String(q.contentId)}` : sql``}
    ${q.channelId ? sql`and ${creditedProperty('channelId')}=${String(q.channelId)}` : sql``}
    ${q.releaseId ? sql`and ${creditedProperty('releaseId')}=${String(q.releaseId)}` : sql``}
    ${q.deploymentId ? sql`and ${creditedProperty('deploymentId')}=${String(q.deploymentId)}` : sql``}
    ${q.author ? sql`and ${creditedProperty('author')}=${q.author}` : sql``}
    ${q.contentType ? sql`and ${creditedProperty('contentType')}=${q.contentType}` : sql``}
    ${q.source ? sql`and ${property('entrySource')}=${q.source}` : sql``}
    ${q.device ? sql`and e.device_type::text=${q.device}` : sql``}`;
}

function grouping(dimension?: Dimension): { key: SQL; label: SQL; condition: SQL } {
  const all = sql`true`;
  if (!dimension) return { key: sql`'all'`, label: sql`'全部'`, condition: all };
  const definition: Record<Dimension, { key: SQL; label: SQL; condition: SQL }> = {
    content: { key: sql`coalesce(${creditedContentId},'未标注')`, label: sql`coalesce(nullif(${property('originContentTitle')},''),case when ${property('originContentId')} is null then nullif(${property('contentTitle')},'') end,'内容 #' || ${creditedContentId},'非内容页面')`, condition: sql`${creditedContentId} is not null` },
    channel: { key: sql`coalesce(${creditedProperty('channelId')},'未标注')`, label: sql`coalesce(${creditedProperty('channelName')},'栏目 #' || ${creditedProperty('channelId')},'未分栏目')`, condition: all },
    author: { key: sql`coalesce(${creditedProperty('author')},'未标注')`, label: sql`coalesce(${creditedProperty('author')},'未标注')`, condition: all },
    contentType: { key: sql`coalesce(${creditedProperty('contentType')},'未标注')`, label: sql`coalesce(${creditedProperty('contentType')},'未标注')`, condition: all },
    release: { key: sql`coalesce(${creditedProperty('releaseId')},'未标注')`, label: sql`coalesce((select name from public.cms_releases r where r.id::text=${creditedProperty('releaseId')}),'发布 #' || ${creditedProperty('releaseId')},'未发布')`, condition: all },
    source: { key: textProperty('entrySource', 'direct'), label: textProperty('entrySource', 'direct'), condition: all },
    entry: { key: textProperty('entryPath', '/'), label: textProperty('entryPath', '/'), condition: all },
    referrer: { key: textProperty('referrerHost', 'direct'), label: textProperty('referrerHost', 'direct'), condition: all },
    utmSource: { key: textProperty('utmSource'), label: textProperty('utmSource'), condition: all },
    utmMedium: { key: textProperty('utmMedium'), label: textProperty('utmMedium'), condition: all },
    utmCampaign: { key: textProperty('utmCampaign'), label: textProperty('utmCampaign'), condition: all },
    utmTerm: { key: textProperty('utmTerm'), label: textProperty('utmTerm'), condition: all },
    utmContent: { key: textProperty('utmContent'), label: textProperty('utmContent'), condition: all },
    device: { key: sql`coalesce(e.device_type::text,'unknown')`, label: sql`coalesce(e.device_type::text,'unknown')`, condition: all },
    browser: { key: sql`coalesce(e.browser,'unknown')`, label: sql`coalesce(e.browser,'unknown')`, condition: all },
    os: { key: sql`coalesce(e.os,'unknown')`, label: sql`coalesce(e.os,'unknown')`, condition: all },
    country: { key: sql`coalesce(e.country,'unknown')`, label: sql`coalesce(e.country,'unknown')`, condition: all },
    search: { key: sql`lower(trim(coalesce(${property('keyword')},'')))`, label: sql`lower(trim(coalesce(${property('keyword')},'')))`, condition: sql`e.event_name in ('cms.search','cms.search_click','cms.read','cms.form_complete','cms.vote_complete','cms.comment_complete','cms.follow_complete') and nullif(trim(${property('keyword')}),'') is not null` },
    media: { key: sql`concat(${textProperty('resourceId')},':',${textProperty('assetVersionId')})`, label: sql`concat(coalesce(nullif(${property('resourceName')},''),'媒体 #' || ${property('resourceId')},'未标注媒体'),' · 版本 ',${textProperty('assetVersionId')})`, condition: sql`e.event_name in ('cms.media_start','cms.media_progress','cms.media_error','cms.download_click','cms.download_delivered')` },
    placement: { key: sql`concat(${textProperty('componentSlot')},':',${textProperty('componentId')})`, label: sql`coalesce(nullif(${property('componentName')},''),${property('componentSlot')},${property('componentId')},'未标注版位')`, condition: sql`e.event_name in ('cms.component_impression','cms.component_click')` },
    form: { key: textProperty('formId'), label: sql`coalesce(nullif(${property('formName')},''),'表单 #' || ${property('formId')},'未标注表单')`, condition: sql`e.event_name in ('cms.form_start','cms.form_error','cms.form_complete')` },
    interaction: { key: sql`concat(e.event_name,':',coalesce(${property('interactionId')},${property('targetId')},'未标注'))`, label: sql`coalesce(nullif(${property('interactionName')},''),nullif(${property('targetName')},''),nullif(${property('contentTitle')},''),'互动 #' || ${property('interactionId')},e.event_name)`, condition: sql`e.event_name in ('cms.vote_complete','cms.comment_complete','cms.follow_complete')` },
  };
  return definition[dimension];
}

/** All reduction happens in PostgreSQL; only the requested aggregate page reaches Node. */
function aggregateCte(q: CmsStatsQuery, scope: CmsStatScope, dimension?: Dimension): SQL {
  const group = grouping(dimension);
  const behaviorDimension = Boolean(dimension && ['search','media','placement','form','interaction'].includes(dimension));
  // Resolve late-arriving search clicks from facts at read time instead of trusting a browser hint.
  const source = dimension === 'search' ? sql`(
    select fact.id,fact.event_name,fact.created_at,fact.tenant_id,fact.device_type,
      fact.properties || case when click.properties is not null then jsonb_build_object('searchId',click.properties->'searchId','keyword',click.properties->'keyword','resultCount',click.properties->'resultCount') else '{}'::jsonb end as properties
    from (select * from public.user_events e where ${cmsStatisticsWhere(q,scope)}) fact left join lateral (
      select c.properties from public.user_events c
      where c.tenant_id is null and c.properties @> ${JSON.stringify({cmsSchemaVersion:2,cmsSiteId:q.siteId,trustedCms:true,environment:'live'})}::jsonb
        and c.event_name='cms.search_click' and coalesce(c.device_type::text,'unknown')<>'bot'
        and c.properties->>'visitorId'=fact.properties->>'visitorId' and c.properties->>'sessionId'=fact.properties->>'sessionId'
        and c.properties->>'targetContentId'=coalesce(fact.properties->>'originContentId',fact.properties->>'contentId')
        and c.created_at<=fact.created_at and c.created_at>fact.created_at-interval '30 minutes'
        and coalesce((c.properties->>'receivedAt')::timestamptz,c.created_at)<=${scope.watermark}::timestamptz
      order by c.created_at desc,c.id desc limit 1
    ) click on fact.event_name in ('cms.read','cms.form_complete','cms.vote_complete','cms.comment_complete','cms.follow_complete')
  )` : sql`public.user_events`;
  return sql`with base as materialized (
    select e.id,e.event_name,e.properties,${group.key} as key,${group.label} as label,
      nullif(${property('visitorId')},'') as visitor,nullif(${property('sessionId')},'') as sid,
      nullif(${property('pageViewId')},'') as view_id,nullif(${property('searchId')},'') as search_id,
      greatest(0,coalesce((${property('activeMs')})::numeric,0)) as active_ms,
      least(100,greatest(0,coalesce((${property('scrollDepth')})::numeric,0))) as scroll_depth
    from ${source} e where ${cmsStatisticsWhere(q, scope)} and ${group.condition}
  ), page_baselines as (
    select ${property('pageViewId')} as view_id,max(greatest(0,coalesce((${property('activeMs')})::numeric,0))) as active_ms
    from public.user_events e where ${cmsStatisticsWhere(q,{...scope,startTime:'1970-01-01T00:00:00.000Z',endTime:scope.startTime})}
      and e.event_name='cms.engagement' and ${property('pageViewId')} in(select distinct view_id from base where active_ms>0)
    group by 1
  ), pages as (
    select b.key,b.view_id,max(b.sid) as sid,greatest(0,max(b.active_ms)-coalesce(max(p.active_ms),0)) as active_ms,max(b.scroll_depth) as scroll_depth,
      bool_or(event_name='cms.page_view') as viewed,bool_or(event_name='cms.read') as read
    from base b left join page_baselines p on p.view_id=b.view_id where b.view_id is not null group by b.key,b.view_id
  ), session_activity as (
    select key,sid,sum(active_ms) as active_ms,bool_or(read) as read from pages where sid is not null group by key,sid
  ), sessions as (
    select b.key,b.sid,count(distinct b.view_id) filter(where b.event_name='cms.page_view') as pv,
      coalesce(max(a.active_ms),0) as active_ms,bool_or(coalesce(a.read,false)) as read,
      bool_or(b.event_name in ${conversionNames}) as converted
    from base b left join session_activity a on a.key=b.key and a.sid=b.sid where b.sid is not null group by b.key,b.sid
  ), visitors as (
    select key,visitor,bool_or(event_name='cms.page_view') as viewed,
      bool_or(event_name='cms.page_view' and coalesce(properties->>'isNewVisitor','false')='true') as is_new,
      bool_or(event_name in ${conversionNames}) as converted from base where visitor is not null group by key,visitor
  ), event_metrics as (
    select key,(array_agg(label order by id desc))[1] as label,
      count(distinct view_id) filter(where event_name='cms.page_view')::int as pv,
      count(distinct view_id) filter(where event_name='cms.read')::int as reads,
      count(distinct view_id) filter(where event_name='cms.read' and exists(select 1 from base v where v.key=base.key and v.view_id=base.view_id and v.event_name='cms.page_view'))::int as "readThroughs",
      count(*) filter(where event_name in ${conversionNames})::int as conversions,
      count(distinct search_id) filter(where event_name='cms.search')::int as searches,
      count(distinct search_id) filter(where event_name='cms.search' and coalesce(properties->>'resultCount','0')::int=0)::int as "noResultSearches",
      count(distinct lower(trim(properties->>'keyword'))) filter(where event_name='cms.search')::int as "uniqueKeywords",
      count(distinct lower(trim(properties->>'keyword'))) filter(where event_name='cms.search' and coalesce(properties->>'resultCount','0')::int=0)::int as "noResultKeywords",
      count(*) filter(where event_name='cms.search_click')::int as "searchClicks",
      count(distinct search_id) filter(where event_name='cms.search_click' and exists(select 1 from base s where s.key=base.key and s.search_id=base.search_id and s.event_name='cms.search'))::int as "searchClickThroughs",
      count(*) filter(where event_name='cms.download_click')::int as "downloadClicks",
      count(*) filter(where event_name='cms.download_delivered')::int as downloads,
      count(*) filter(where event_name='cms.form_start')::int as "formStarts",
      count(*) filter(where event_name='cms.form_error')::int as "formErrors",
      count(*) filter(where event_name='cms.form_complete')::int as "formCompletions",
      count(*) filter(where event_name='cms.vote_complete')::int as votes,
      count(*) filter(where event_name='cms.comment_complete')::int as comments,
      count(*) filter(where event_name='cms.follow_complete')::int as follows,
      count(distinct concat(view_id,':',properties->>'componentId')) filter(where event_name='cms.component_impression')::int as impressions,
      count(*) filter(where event_name='cms.component_click')::int as clicks,
      count(distinct concat(view_id,':',properties->>'componentId')) filter(where event_name='cms.component_click' and exists(
        select 1 from base impression where impression.key=base.key and impression.view_id=base.view_id and impression.event_name='cms.component_impression'
          and impression.properties->>'componentId'=base.properties->>'componentId'
      ))::int as "clickThroughs",
      count(distinct concat(view_id,':',properties->>'resourceId',':',properties->>'assetVersionId')) filter(where event_name='cms.media_start')::int as "mediaStarts",
      count(distinct concat(view_id,':',properties->>'resourceId',':',properties->>'assetVersionId')) filter(where event_name='cms.media_progress' and coalesce(properties->>'mediaProgress','0')::numeric>=25)::int as "media25",
      count(distinct concat(view_id,':',properties->>'resourceId',':',properties->>'assetVersionId')) filter(where event_name='cms.media_progress' and coalesce(properties->>'mediaProgress','0')::numeric>=50)::int as "media50",
      count(distinct concat(view_id,':',properties->>'resourceId',':',properties->>'assetVersionId')) filter(where event_name='cms.media_progress' and coalesce(properties->>'mediaProgress','0')::numeric>=75)::int as "media75",
      count(distinct concat(view_id,':',properties->>'resourceId',':',properties->>'assetVersionId')) filter(where event_name='cms.media_progress' and coalesce(properties->>'mediaProgress','0')::numeric>=100)::int as "mediaCompletions",
      count(*) filter(where event_name='cms.media_error')::int as "mediaErrors"
    from base group by key
  ), visitor_metrics as (
    select key,count(*) filter(where viewed or ${behaviorDimension})::int as uv,count(*) filter(where (viewed or ${behaviorDimension}) and is_new)::int as "newVisitors",
      count(*) filter(where (viewed or ${behaviorDimension}) and not is_new)::int as "returningVisitors",count(*) filter(where (viewed or ${behaviorDimension}) and converted)::int as "conversionVisitors" from visitors group by key
  ), session_metrics as (
    select key,count(*) filter(where pv>0 or ${behaviorDimension})::int as sessions,
      count(*) filter(where (pv>0 or ${behaviorDimension}) and (active_ms>=10000 or read or converted or pv>=2))::int as "engagedSessions" from sessions group by key
  ), page_metrics as (
    select key,coalesce(sum(active_ms),0) as "activeMs",coalesce(avg(scroll_depth) filter(where viewed),0) as "avgScrollDepth" from pages group by key
  ), metrics as (
    select m.*,coalesce(v.uv,0) as uv,coalesce(v."newVisitors",0) as "newVisitors",coalesce(v."returningVisitors",0) as "returningVisitors",
      coalesce(v."conversionVisitors",0) as "conversionVisitors",coalesce(s.sessions,0) as sessions,coalesce(s."engagedSessions",0) as "engagedSessions",
      coalesce(p."activeMs",0) as "activeMs",coalesce(p."avgScrollDepth",0) as "avgScrollDepth"
    from event_metrics m left join visitor_metrics v using(key) left join session_metrics s using(key) left join page_metrics p using(key)
  )`;
}

export function mapCmsStatMetrics(row?: Partial<SqlMetricRow>): CmsStatMetrics {
  const num = (key: keyof CmsStatMetrics) => Number(row?.[key] ?? 0);
  const pv = num('pv'), uv = num('uv'), sessions = num('sessions'), engagedSessions = num('engagedSessions'), activeMs = num('activeMs');
  return { pv, uv, sessions, newVisitors: num('newVisitors'), returningVisitors: num('returningVisitors'), reads: num('reads'), readRate: cmsStatRate(Number(row?.readThroughs ?? 0),pv), activeMs,
    avgActiveMs: pv ? Math.round(activeMs / pv) : 0, avgScrollDepth: Math.round(num('avgScrollDepth') * 100) / 100, engagedSessions,
    engagementRate: cmsStatRate(engagedSessions, sessions), bounceRate: cmsStatRate(sessions - engagedSessions, sessions),
    conversions: num('conversions'), conversionVisitors: num('conversionVisitors'), conversionRate: cmsStatRate(num('conversionVisitors'), uv),
    searches: num('searches'), noResultSearches: num('noResultSearches'), uniqueKeywords: num('uniqueKeywords'), noResultKeywords: num('noResultKeywords'), searchClicks: num('searchClicks'), searchClickRate: cmsStatRate(Number(row?.searchClickThroughs ?? 0),num('searches')),
    downloadClicks: num('downloadClicks'), downloads: num('downloads'), formStarts: num('formStarts'), formErrors: num('formErrors'), formCompletions: num('formCompletions'), votes: num('votes'), comments: num('comments'), follows: num('follows'),
    impressions: num('impressions'), clicks: num('clicks'), ctr: cmsStatRate(Number(row?.clickThroughs ?? 0), num('impressions')), mediaStarts: num('mediaStarts'), media25: num('media25'), media50: num('media50'), media75: num('media75'), mediaCompletions: num('mediaCompletions'), mediaErrors: num('mediaErrors') };
}

async function metrics(tx: DbTransaction, q: CmsStatsQuery, scope: CmsStatScope): Promise<CmsStatMetrics> {
  const [row] = await tx.execute<SqlMetricRow>(sql`${aggregateCte(q, scope)} select * from metrics`);
  return mapCmsStatMetrics(row);
}
async function trend(tx: DbTransaction, q: CmsStatsQuery, scope: CmsStatScope): Promise<CmsStatOverview['trend']> {
  const format = scope.granularity === 'hour' ? 'YYYY-MM-DD HH24:00' : 'YYYY-MM-DD';
  const step = scope.granularity === 'hour' ? '1 hour' : '1 day';
  const unit = scope.granularity === 'hour' ? 'hour' : 'day';
  return tx.execute<CmsStatOverview['trend'][number]>(sql`with buckets as (
      select distinct to_char(t,${format}) as date from generate_series(
        date_trunc(${unit},${scope.startTime}::timestamptz at time zone ${scope.timeZone}),
        date_trunc(${unit},(${scope.endTime}::timestamptz-interval '1 microsecond') at time zone ${scope.timeZone}),${step}::interval) t
    ), counts as (
      select to_char(e.created_at at time zone ${scope.timeZone},${format}) as date,
        count(distinct ${property('pageViewId')}) filter(where e.event_name='cms.page_view')::int as pv,
        count(distinct ${property('visitorId')}) filter(where e.event_name='cms.page_view')::int as uv,
        count(distinct ${property('sessionId')}) filter(where e.event_name='cms.page_view')::int as sessions,
        count(distinct ${property('pageViewId')}) filter(where e.event_name='cms.read')::int as reads,
        count(*) filter(where e.event_name in ${conversionNames})::int as conversions,
        count(distinct ${property('searchId')}) filter(where e.event_name='cms.search')::int as searches
      from public.user_events e where ${cmsStatisticsWhere(q, scope)} group by 1
    ) select b.date,coalesce(c.pv,0) as pv,coalesce(c.uv,0) as uv,coalesce(c.sessions,0) as sessions,coalesce(c.reads,0) as reads,
      coalesce(c.conversions,0) as conversions,coalesce(c.searches,0) as searches from buckets b left join counts c using(date) order by b.date`);
}

async function telemetryState(tx: DbTransaction, siteId: number) {
  const [current] = await tx.execute<{ settings: Record<string, unknown>; generationId: number | null }>(sql`
    select s.settings, g.active_generation_id as "generationId" from public.cms_sites s
    left join public.cms_site_generations g on g.site_id=s.id where s.id=${siteId}`);
  let published: Record<string, unknown> = {};
  if (current?.generationId) {
    // Deployment manifests contain table hashes/counts; public configuration lives in the sealed projection.
    const schema = sql.identifier(cmsGenerationSchemaName(current.generationId));
    const [row] = await tx.execute<{ settings: Record<string, unknown> }>(sql`select settings from ${schema}.cms_site_projection where id=${siteId}`);
    published = row?.settings ?? {};
  }
  const configured = current?.settings?.telemetry as { enabled?: boolean; schemaVersion?: number } | undefined;
  const active = published.telemetry as { enabled?: boolean; schemaVersion?: number } | undefined;
  return { configured: configured?.enabled === true && configured.schemaVersion === 2, published: active?.enabled === true && active.schemaVersion === 2,
    changed: JSON.stringify(configured ?? {}) !== JSON.stringify(active ?? {}) };
}
const qualityStatus = (state: Awaited<ReturnType<typeof telemetryState>>, accepted: number, rejected = 0): CmsStatQuality['status'] =>
  state.changed ? 'pending_publication' : !state.configured ? 'disabled' : rejected > 0 ? 'attention' : accepted > 0 ? 'collecting' : 'empty';

export async function getCmsStatsOverview(q: CmsStatsQuery): Promise<CmsStatOverview> {
  await assertCmsStatisticsAccess(q.siteId); const scope = resolveCmsStatsWindow(q);
  return readSnapshot(async (tx) => {
    const current = await metrics(tx, q, scope);
    const [coverage]=await tx.execute<{since:Date|null}>(sql`select min(e.created_at) as since from public.user_events e where e.tenant_id is null and e.properties @> ${JSON.stringify({cmsSiteId:q.siteId,cmsSchemaVersion:2,trustedCms:true,environment:'live'})}::jsonb and coalesce((e.properties->>'receivedAt')::timestamptz,e.created_at)<=${scope.watermark}::timestamptz`);
    const collectionAvailableSince=coverage?.since?new Date(coverage.since).toISOString():null;
    const comparisonAvailable=Boolean(scope.comparisonStart&&scope.comparisonEnd&&collectionAvailableSince&&collectionAvailableSince<=scope.comparisonStart);
    const previousMetrics = comparisonAvailable ? await metrics(tx, q, { ...scope, startTime: scope.comparisonStart!, endTime: scope.comparisonEnd! }) : null;
    return { scope, status: qualityStatus(await telemetryState(tx, q.siteId), current.pv), metrics: current, previousMetrics, collectionAvailableSince, comparisonAvailable,
      comparisonUnavailableReason:scope.comparisonStart&&!comparisonAvailable?'统一采集尚未覆盖完整对比区间，不将缺失历史视为零流量':null,trend: await trend(tx, q, scope) };
  });
}

export async function getCmsStatsReport(q: ReportQuery): Promise<CmsStatReport> {
  await assertCmsStatisticsAccess(q.siteId); const scope = resolveCmsStatsWindow(q); const dimension = q.dimension ?? 'content';
  const cte = aggregateCte(q, scope, dimension);
  const keywordFilter = keywordCondition(q.keyword, [sql`label`], 'ilike');
  const filter = keywordFilter ? sql`where ${keywordFilter}` : sql``;
  // Identifiers are closed contract enums; user strings never enter raw SQL.
  const sort = sql.identifier(q.sortBy ?? 'pv'); const order = q.sortOrder === 'asc' ? sql`asc` : sql`desc`;
  return readSnapshot(async (tx) => ({ scope, dimension, ...await buildListResult<SqlMetricRow, CmsStatReportRow>({
    page: q.page, pageSize: q.pageSize,
    count: async () => { const [row] = await tx.execute<{ count: number }>(sql`${cte} select count(*)::int as count from metrics ${filter}`); return row?.count ?? 0; },
    rows: () => tx.execute<SqlMetricRow>(sql`${cte} select * from metrics ${filter} order by ${sort} ${order},key asc limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`),
    map: (row) => ({ key: row.key, label: row.label, ...mapCmsStatMetrics(row) }),
  }) }));
}

export async function getCmsStatsQuality(q: CmsStatsQuery): Promise<CmsStatQuality> {
  await assertCmsStatisticsAccess(q.siteId); const scope = resolveCmsStatsWindow(q);
  return readSnapshot(async (tx) => {
    const state = await telemetryState(tx, q.siteId);
    const [receipts] = await tx.execute<{ accepted: number; rejected: number; duplicates: number }>(sql`select coalesce(sum(accepted),0)::int as accepted,coalesce(sum(rejected),0)::int as rejected,coalesce(sum(duplicates),0)::int as duplicates from public.cms_telemetry_receipts where site_id=${q.siteId} and created_at>=${scope.startTime}::timestamptz and created_at<${scope.endTime}::timestamptz`);
    const [latest] = await tx.execute<{ received: Date | null }>(sql`select max(created_at) as received from public.cms_telemetry_receipts where site_id=${q.siteId}`);
    const [outbox]=await tx.execute<{pending:number;failed:number}>(sql`select count(*)::int as pending,count(*) filter(where attempts>0)::int as failed from public.cms_telemetry_outbox where site_id=${q.siteId} and delivered_at is null and created_at<=${scope.watermark}::timestamptz`);
    const [facts] = await tx.execute<{ last: Date | null; latency: string | null; withoutPage: number; withoutVisitor: number }>(sql`select max(e.created_at) as last,
      percentile_cont(0.95) within group(order by greatest(0,extract(epoch from ((${property('receivedAt')})::timestamptz-e.created_at))*1000)) filter(where ${property('receivedAt')} is not null)::text as latency,
      count(*) filter(where nullif(${property('pageViewId')},'') is null)::int as "withoutPage",
      count(*) filter(where nullif(${property('visitorId')},'') is null)::int as "withoutVisitor"
      from public.user_events e where ${cmsStatisticsWhere(q, scope)}`);
    const eventTypes = await tx.execute<{ event: string; count: number }>(sql`select e.event_name as event,count(*)::int as count from public.user_events e where ${cmsStatisticsWhere(q, scope)} group by e.event_name order by count desc,event`);
    const reasons = await tx.execute<{ reason: string; count: number }>(sql`select coalesce(reason,'未分类') as reason,sum(rejected)::int as count from public.cms_telemetry_receipts where site_id=${q.siteId} and created_at>=${scope.startTime}::timestamptz and created_at<${scope.endTime}::timestamptz and rejected>0 group by reason order by count desc,reason`);
    const accepted = receipts?.accepted ?? 0, rejected = receipts?.rejected ?? 0, duplicates = receipts?.duplicates ?? 0;
    return { scope, status: qualityStatus(state, accepted, rejected+(outbox?.failed??0)), configuredEnabled: state.configured, publishedEnabled: state.published,pendingConversions:outbox?.pending??0,failedConversions:outbox?.failed??0,
      acceptedEvents: accepted, rejectedEvents: rejected, duplicateEvents: duplicates, rejectionRate: cmsStatRate(rejected, accepted + rejected + duplicates), duplicateRate: cmsStatRate(duplicates, accepted + rejected + duplicates),
      lastReceivedAt: latest?.received ? new Date(latest.received).toISOString() : null, lastEventAt: facts?.last ? new Date(facts.last).toISOString() : null,
      latencyP95Ms: facts?.latency == null ? null : Math.round(Number(facts.latency)), eventsWithoutPage: facts?.withoutPage ?? 0, eventsWithoutVisitor: facts?.withoutVisitor ?? 0, eventTypes, reasons };
  });
}

export async function getCmsStatsOptions(q: CmsStatsQuery): Promise<CmsStatOptions> {
  await assertCmsStatisticsAccess(q.siteId); const scope = resolveCmsStatsWindow(q);
  return readSnapshot(async (tx) => {
    const result: CmsStatOptions = { content: [], channel: [], author: [], release: [] };
    for (const dimension of ['content','channel','author','release'] as const) {
      const group = grouping(dimension);
      result[dimension] = await tx.execute<{ value:string;label:string }>(sql`select ${group.key} as value,max(${group.label}) as label from public.user_events e where ${cmsStatisticsWhere(q, scope)} and ${group.condition} group by 1 order by label,value limit 200`);
    }
    return result;
  });
}

/** Small dashboard projections still use the exact same v2 facts and snapshot as the full reports. */
export async function getCmsVisitStatsV2(q: CmsStatsQuery) {
  await assertCmsStatisticsAccess(q.siteId); const scope = resolveCmsStatsWindow(q);
  return readSnapshot(async (tx) => {
    const current = await metrics(tx, q, scope); const rows = await trend(tx, { ...q, granularity: 'day' }, { ...scope, granularity: 'day' });
    const days = await tx.execute<{ day: string; pv: number; uv: number; ips: number }>(sql`select to_char(e.created_at at time zone ${scope.timeZone},'YYYY-MM-DD') as day,
      count(distinct ${property('pageViewId')})::int as pv,count(distinct ${property('visitorId')})::int as uv,count(distinct e.ip)::int as ips from public.user_events e
      where ${cmsStatisticsWhere(q, { ...scope, startTime: new Date(Date.now() - 3 * 86400000).toISOString(), endTime: scope.watermark })} and e.event_name='cms.page_view' group by 1`);
    const labels = await tx.execute<{ today: string; yesterday: string }>(sql`select to_char(${scope.watermark}::timestamptz at time zone ${scope.timeZone},'YYYY-MM-DD') as today,to_char((${scope.watermark}::timestamptz at time zone ${scope.timeZone})-interval '1 day','YYYY-MM-DD') as yesterday`);
    const metric = (key?: string) => { const hit = days.find((row) => row.day === key); return { pv: hit?.pv ?? 0, uv: hit?.uv ?? 0, ips: hit?.ips ?? 0 }; };
    const contents = await tx.execute<SqlMetricRow>(sql`${aggregateCte(q, scope, 'content')} select * from metrics order by pv desc,key limit 20`);
    const devices = await tx.execute<{ deviceType: 'pc' | 'mobile' | 'bot'; pv: number }>(sql`select case when e.device_type in ('mobile','tablet') then 'mobile' else 'pc' end as "deviceType",count(distinct ${property('pageViewId')})::int as pv from public.user_events e where ${cmsStatisticsWhere(q, scope)} and e.event_name='cms.page_view' group by 1`);
    const referrers = await tx.execute<{ host: string; pv: number }>(sql`select ${property('referrerHost')} as host,count(distinct ${property('pageViewId')})::int as pv from public.user_events e where ${cmsStatisticsWhere(q, scope)} and e.event_name='cms.page_view' and nullif(${property('referrerHost')},'') is not null group by 1 order by pv desc,host limit 10`);
    return { today: metric(labels[0]?.today), yesterday: metric(labels[0]?.yesterday), totalPv: current.pv, trend: rows.map(({ date,pv,uv }) => ({ date,pv,uv })), topContents: contents.map((row) => ({ contentId: Number(row.key), title: row.label, pv: Number(row.pv), uv: Number(row.uv) })), devices, referrers };
  });
}

export async function getCmsSearchAnalyticsV2(q: CmsStatsQuery) {
  await assertCmsStatisticsAccess(q.siteId); const scope = resolveCmsStatsWindow(q);
  return readSnapshot(async (tx) => {
    const current = await metrics(tx,q,scope); const rows = await trend(tx,{ ...q, granularity: 'day' },{ ...scope, granularity: 'day' });
    const terms = await tx.execute<{ keyword: string; count: number; avgResults: number; zero: number }>(sql`select lower(trim(${property('keyword')})) as keyword,count(distinct ${property('searchId')})::int as count,
      round(avg((${property('resultCount')})::numeric))::int as "avgResults",count(distinct ${property('searchId')}) filter(where (${property('resultCount')})::int=0)::int as zero
      from public.user_events e where ${cmsStatisticsWhere(q,scope)} and e.event_name='cms.search' group by 1 order by count desc,keyword limit 20`);
    const zero = await tx.execute<{ keyword: string; count: number }>(sql`select lower(trim(${property('keyword')})) as keyword,count(distinct ${property('searchId')})::int as count from public.user_events e where ${cmsStatisticsWhere(q,scope)} and e.event_name='cms.search' and (${property('resultCount')})::int=0 group by 1 order by count desc,keyword limit 20`);
    return { total: current.searches, trend: rows.map(({date,searches}) => ({date,count:searches})), topKeywords: terms.map(({keyword,count,avgResults}) => ({keyword,count,avgResults})), noResultKeywords: zero };
  });
}
