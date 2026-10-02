import { sql } from 'drizzle-orm';
import type { QueryOutputOf } from '@arcbase/shared/core';
import { CMS_ATTRIBUTION_EVENTS, cmsOperationsContract, cmsStatsQuery, type CmsAttribution } from '@arcbase/shared/cms';
import { readSnapshot } from '../../db';
import { ensureCmsSiteExists } from './cms-sites.service';
import { assertCmsStatisticsAccess, cmsStatisticsWhere } from './cms-stats-query';
import { resolveCmsStatsWindow } from './cms-stats-window';

/** A compact workbench projection of v2 facts. Full dimension lists use the paginated statistics report. */
export async function getCmsAttribution(q: QueryOutputOf<typeof cmsOperationsContract.attribution>): Promise<CmsAttribution> {
  await assertCmsStatisticsAccess(q.siteId);
  const site = await ensureCmsSiteExists(q.siteId);
  const telemetry = site.settings?.telemetry as { timeZone?: string } | undefined;
  const query = cmsStatsQuery.parse({ siteId: q.siteId, startTime: q.startTime, endTime: q.endTime, releaseId: q.releaseId, deploymentId: q.deploymentId, timeZone: telemetry?.timeZone });
  const scope = resolveCmsStatsWindow(query);
  const content = sql`coalesce(nullif(e.properties->>'originContentId',''),nullif(e.properties->>'contentId',''))`;
  const selected = q.contentId ? sql`and ${content}=${String(q.contentId)}` : sql``;
  const common = sql`with attributed as (
    select e.*,${content} as content_id,
      case e.event_name when 'cms.page_view' then 'cms.entry' when 'cms.component_click' then 'cms.topic_click'
        when 'cms.download_delivered' then 'cms.download' else e.event_name end as event
    from public.user_events e where ${cmsStatisticsWhere(query,scope)} ${selected}
      and e.event_name in ('cms.page_view','cms.read','cms.component_click','cms.download_delivered','cms.form_complete','cms.vote_complete')
  )`;
  return readSnapshot(async (tx) => {
    const totals = await tx.execute<{ event: string; count: number; visitors: number }>(sql`${common}
      select event,count(distinct case when event in ('cms.entry','cms.read') then properties->>'pageViewId' else coalesce(event_id::text,id::text) end)::int as count,
        count(distinct properties->>'visitorId')::int as visitors from attributed group by event`);
    const journeys = await tx.execute<CmsAttribution['journeys'][number] & { entries: number }>(sql`${common}
      select case when a.content_id ~ '^[0-9]+$' then a.content_id::int else null end as "contentId",
        coalesce(max(a.properties->>'originContentTitle'),max(c.title),max(a.properties->>'contentTitle')) as "contentTitle",
        case when coalesce(a.properties->>'originReleaseId',a.properties->>'releaseId') ~ '^[0-9]+$' then coalesce(a.properties->>'originReleaseId',a.properties->>'releaseId')::int else null end as "releaseId",
        case when coalesce(a.properties->>'originDeploymentId',a.properties->>'deploymentId') ~ '^[0-9]+$' then coalesce(a.properties->>'originDeploymentId',a.properties->>'deploymentId')::int else null end as "deploymentId",
        coalesce(a.properties->>'entryPath','/') as "entryPath",coalesce(a.properties->>'entrySource','direct') as source,
        count(distinct a.properties->>'pageViewId') filter(where a.event='cms.entry')::int as entries,count(distinct a.properties->>'pageViewId') filter(where a.event='cms.read')::int as reads,
        count(*) filter(where a.event='cms.topic_click')::int as clicks,count(*) filter(where a.event='cms.download')::int as downloads,
        count(*) filter(where a.event='cms.form_complete')::int as "formCompletions",count(*) filter(where a.event='cms.vote_complete')::int as "voteCompletions"
      from attributed a left join public.cms_contents c on c.id::text=a.content_id and c.site_id=${q.siteId}
      group by a.content_id,coalesce(a.properties->>'originReleaseId',a.properties->>'releaseId'),coalesce(a.properties->>'originDeploymentId',a.properties->>'deploymentId'),a.properties->>'entryPath',a.properties->>'entrySource'
      order by count(*) desc,a.content_id nulls last limit 100`);
    return { totals: CMS_ATTRIBUTION_EVENTS.map((event) => ({ event, count: totals.find((row) => row.event===event)?.count ?? 0, visitors: totals.find((row) => row.event===event)?.visitors ?? 0 })), journeys };
  });
}
