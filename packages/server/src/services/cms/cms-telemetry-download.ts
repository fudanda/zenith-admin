import { buildWhere } from '../../lib/where-helpers';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { cmsTelemetryConversionContextSchema } from '@arcbase/shared/cms';
import { db } from '../../db';
import { cmsAssetRights, cmsAssetVersions, cmsResources } from '../../db/schema';
import { verifyCmsTelemetryPageToken } from './cms-telemetry-context';
import { enqueueCmsTelemetryConversion } from './cms-telemetry-business';

/** Called only after normal file authorization and a successful storage read. Counts responses, not disk saves. */
export async function recordCmsDownloadResponse(fileId: string, raw: string | undefined): Promise<void> {
  if (!raw || raw.length > 18000) return;
  let input: Record<string, unknown>;
  try { input = JSON.parse(raw) as Record<string, unknown>; } catch { return; }
  const context = cmsTelemetryConversionContextSchema.safeParse(input);
  if (!context.success || typeof input.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.requestId)) return;
  const page = verifyCmsTelemetryPageToken(context.data.contextToken);
  if (!page || page.environment !== 'live') return;
  const requestId = input.requestId;
  await db.transaction(async tx => {
    const [asset] = await tx.select({ resourceId: cmsAssetVersions.resourceId, versionId: cmsAssetVersions.id, name: cmsResources.name }).from(cmsAssetVersions)
      .innerJoin(cmsResources, eq(cmsResources.id, cmsAssetVersions.resourceId)).leftJoin(cmsAssetRights, eq(cmsAssetRights.resourceId, cmsResources.id))
      .where(buildWhere(eq(cmsAssetVersions.fileId, fileId), eq(cmsAssetVersions.siteId, page.siteId), eq(cmsResources.siteId, page.siteId),
        page.revisionId ? sql`exists(select 1 from cms_content_revisions revision where revision.id=${page.revisionId} and revision.content_id=${page.contentId} and revision.snapshot->'assetVersions'->>(${cmsAssetVersions.resourceId}::text)=${cmsAssetVersions.id}::text)` : undefined,
        or(isNull(cmsAssetRights.id), and(eq(cmsAssetRights.revoked, false), or(isNull(cmsAssetRights.expiresAt), sql`${cmsAssetRights.expiresAt}>now()`))),
      )).limit(1);
    if (!asset) return;
    await enqueueCmsTelemetryConversion(tx, page.siteId, 'download', requestId, context.data, null, `resource:${asset.resourceId}`, asset.name,
      { resourceId: asset.resourceId, assetVersionId: asset.versionId });
  });
}
