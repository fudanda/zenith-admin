import { buildWhere } from '../../lib/where-helpers';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { CmsTelemetryPageContext } from '@arcbase/shared/cms';
import { db } from '../../db';
import { cmsAssetVersions, cmsResources, cmsChannels, cmsContents, cmsContentWorkingCopies, cmsDeployments, type CmsSiteRow } from '../../db/schema';
import type { CmsSeo } from '../../cms/themes/types';
import { cmsGenerationContext } from './cms-generation-context';
import { cmsTelemetryEnvironment, signCmsTelemetryPage } from './cms-telemetry-context';

const revisionsByGeneration = new Map<number, ReadonlyMap<number, number>>();
async function generationRevision(generationId: number, contentId: number): Promise<number | null> {
  let revisions = revisionsByGeneration.get(generationId);
  if (!revisions) {
    // During static generation the sealed reference table does not exist yet.
    // The persisted projection manifest is already frozen before that phase begins.
    const [row] = await db.select({ snapshot: cmsDeployments.snapshot }).from(cmsDeployments).where(eq(cmsDeployments.id, generationId)).limit(1);
    if (!row?.snapshot) return null;
    revisions = new Map(row.snapshot.revisions.map(ref => [ref.contentId, ref.revisionId]));
    if (revisionsByGeneration.size >= 16) revisionsByGeneration.delete(revisionsByGeneration.keys().next().value!);
    revisionsByGeneration.set(generationId, revisions);
  }
  return revisions.get(contentId) ?? null;
}

/** Media can be measured before optional transcoding; its immutable source version still identifies it. */
export async function findCmsRenderedMediaAsset(siteId: number, mediaUrl: string, revisionId?: number | null) {
  const handle = /^cms-res:\/\/(\d+)$/.exec(mediaUrl);
  const fileId = /\/api\/files\/([\da-f-]{36})\/content/i.exec(mediaUrl)?.[1];
  const [asset] = await db.select({ resourceId: cmsAssetVersions.resourceId, assetVersionId: cmsAssetVersions.id, name: cmsResources.name })
    .from(cmsAssetVersions).innerJoin(cmsResources, eq(cmsResources.id, cmsAssetVersions.resourceId))
    .where(buildWhere(eq(cmsAssetVersions.siteId, siteId), handle ? eq(cmsAssetVersions.resourceId, Number(handle[1])) : fileId ? eq(cmsAssetVersions.fileId, fileId) : eq(cmsAssetVersions.url, mediaUrl),
      revisionId ? sql`exists(select 1 from cms_content_revisions revision where revision.id=${revisionId} and revision.snapshot->'assetVersions'->>(${cmsAssetVersions.resourceId}::text)=${cmsAssetVersions.id}::text)` : undefined,
    )).orderBy(desc(cmsAssetVersions.id)).limit(1);
  return asset;
}

/** Executed against the frozen generation, so cache hits retain exact content and revision identity. */
export async function buildCmsTelemetryContext(site: CmsSiteRow, seo: CmsSeo, contentId?: number, search?: CmsTelemetryPageContext['search'], channelId?: number) {
  const settings = site.settings?.telemetry as { enabled?: boolean; schemaVersion?: number } | undefined;
  const siteKey = site.settings?.analyticsSiteKey;
  if (!settings?.enabled || settings.schemaVersion !== 2 || typeof siteKey !== 'string') return null;
  const generation = cmsGenerationContext();
  const [deployment] = generation ? await db.select({ releaseId: cmsDeployments.releaseId }).from(cmsDeployments).where(eq(cmsDeployments.id, generation.generationId)).limit(1) : [];
  const [content] = contentId ? await db.select({ id: cmsContents.id, title: cmsContents.title, contentType: cmsContents.contentType, author: cmsContents.author, channelId: cmsContents.channelId, channelName: cmsChannels.name })
    .from(cmsContents).leftJoin(cmsChannels, eq(cmsChannels.id, cmsContents.channelId)).where(and(eq(cmsContents.id, contentId), eq(cmsContents.siteId, site.id))).limit(1) : [];
  let revisionId: number | null = null;
  if (content && generation) {
    revisionId = await generationRevision(generation.generationId, content.id);
  } else if (content) {
    const [working] = await db.select({ revisionId: cmsContentWorkingCopies.publishedRevisionId }).from(cmsContentWorkingCopies).where(eq(cmsContentWorkingCopies.contentId, content.id)).limit(1);
    revisionId = working?.revisionId ?? null;
  }
  const [channel] = !content && channelId ? await db.select({ id: cmsChannels.id, name: cmsChannels.name }).from(cmsChannels).where(and(eq(cmsChannels.id, channelId), eq(cmsChannels.siteId, site.id))).limit(1) : [];
  const canonicalPath = seo.pagePath ?? '/';
  const pageType = content ? 'detail' : search ? 'search' : canonicalPath === '/' ? 'home' : canonicalPath.startsWith('/p/') ? 'page' : canonicalPath.startsWith('/tag/') ? 'tag' : 'list';
  return signCmsTelemetryPage({ version: 2, siteId: site.id, siteKey, environment: cmsTelemetryEnvironment(), canonicalPath, pageType,
    contentId: content?.id ?? null, contentTitle: content?.title ?? null, contentType: content?.contentType ?? null, author: content?.author ?? null,
    channelId: content?.channelId ?? channel?.id ?? null, channelName: content?.channelName ?? channel?.name ?? null, revisionId,
    deploymentId: generation?.generationId ?? null, releaseId: deployment?.releaseId ?? null, ...(search ? { search } : {}),
  });
}
