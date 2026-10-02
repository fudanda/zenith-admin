import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { z } from 'zod';
import { CMS_MEDIA_PROCESSING_TASK, cmsMediaProcessingSchema, freezeCmsMediaResult, type CmsFrozenMedia, type CmsMediaResult, type CmsResource, type processCmsMediaSchema } from '@arcbase/shared/cms';
import { db } from '../../db';
import { cmsResources } from '../../db/schema/cms';
import { cmsAssetVersions } from '../../db/schema/cms-design';
import { cmsMediaProcessing } from '../../db/schema/cms-media';
import { asyncTasks } from '../../db/schema/tasks';
import type { DbExecutor } from '../../db/types';
import { requireRow } from '../../lib/db-assert';
import { pickEntity } from '../../lib/entity-map';
import { enqueueAsyncTask, persistAsyncTask } from '../../lib/task-center';
import { releaseManagedFiles } from '../files/file-gc.service';
import { assertSiteAccess } from './cms-sites.service';
import { ensureCmsAssetVersion } from './cms-design-versions.service';

async function mediaResource(resourceId: number) {
  const [row] = await db.select().from(cmsResources).where(eq(cmsResources.id, resourceId)).limit(1);
  requireRow(row, '素材不存在');
  await assertSiteAccess(row.siteId);
  return row;
}

export async function getCmsMedia(resourceId: number) {
  const resource = await mediaResource(resourceId);
  const [version] = await db.select({ id: cmsAssetVersions.id }).from(cmsAssetVersions)
    .where(and(eq(cmsAssetVersions.resourceId, resourceId), eq(cmsAssetVersions.url, resource.url))).orderBy(desc(cmsAssetVersions.version)).limit(1);
  if (!version) return { assetVersionId: null, processing: null };
  const [row] = await db.select({ processing: cmsMediaProcessing, task: asyncTasks, subtitleResourceId: cmsAssetVersions.resourceId }).from(cmsMediaProcessing)
    .leftJoin(asyncTasks, eq(asyncTasks.id, cmsMediaProcessing.taskId))
    .leftJoin(cmsAssetVersions, eq(cmsAssetVersions.id, cmsMediaProcessing.subtitleVersionId))
    .where(eq(cmsMediaProcessing.assetVersionId, version.id)).orderBy(desc(cmsMediaProcessing.id)).limit(1);
  if (!row) return { assetVersionId: version.id, processing: null };
  return { assetVersionId: version.id, processing: pickEntity(cmsMediaProcessingSchema, row.processing, {
    resourceId, subtitleResourceId: row.subtitleResourceId,
    status: row.processing.status === 'success' ? 'success' : row.task?.status ?? row.processing.status,
    errorMessage: row.task?.errorMessage ?? row.processing.errorMessage,
  }) };
}

export async function submitCmsMediaProcessing(resourceId: number, input: z.output<typeof processCmsMediaSchema>) {
  const resource = await mediaResource(resourceId);
  if (!['image', 'audio', 'video'].includes(resource.type)) throw new HTTPException(400, { message: '仅图片、音频和视频支持媒体处理' });
  const task = await db.transaction(async (tx) => {
    // Version locking also serializes replacement and duplicate submissions for this resource.
    const currentVersion = await ensureCmsAssetVersion(tx, resourceId, resource.siteId);
    const [version] = await tx.select().from(cmsAssetVersions).where(and(eq(cmsAssetVersions.id, input.assetVersionId ?? currentVersion.id), eq(cmsAssetVersions.resourceId, resourceId), eq(cmsAssetVersions.siteId, resource.siteId))).limit(1);
    requireRow(version, '文件版本不存在或不属于此素材');
    if (!version.fileId) throw new HTTPException(400, { message: '外链素材不能进行服务器媒体处理，请先上传文件' });
    const [active] = await tx.select({ id: asyncTasks.id }).from(cmsMediaProcessing).innerJoin(asyncTasks, eq(asyncTasks.id, cmsMediaProcessing.taskId))
      .where(and(eq(cmsMediaProcessing.assetVersionId, version.id), inArray(asyncTasks.status, ['pending', 'running']))).limit(1);
    if (active) throw new HTTPException(409, { message: '此文件版本已有进行中的处理任务，请等待完成' });
    let subtitleVersionId: number | null = null;
    if (input.subtitleResourceId) {
      if (!(version.mimeType?.startsWith('video/') || version.mimeType?.startsWith('audio/'))) throw new HTTPException(400, { message: '只有音视频可以关联字幕' });
      const [subtitle] = await tx.select().from(cmsResources).where(and(eq(cmsResources.id, input.subtitleResourceId), eq(cmsResources.siteId, resource.siteId))).limit(1);
      requireRow(subtitle, '字幕素材不存在或不属于当前站点');
      if (!subtitle.fileId || !/\.vtt$/i.test(subtitle.name)) throw new HTTPException(400, { message: '请选择本站已上传的 .vtt 字幕文件' });
      subtitleVersionId = (await ensureCmsAssetVersion(tx, subtitle.id, resource.siteId)).id;
    }
    const [processing] = await tx.insert(cmsMediaProcessing).values({ assetVersionId: version.id, subtitleVersionId,
      focalPoint: input.focalPoint, posterTime: input.posterTime, subtitleLabel: input.subtitleLabel, subtitleLanguage: input.subtitleLanguage }).returning();
    const created = await persistAsyncTask(tx, { taskType: CMS_MEDIA_PROCESSING_TASK, title: `媒体处理 · ${resource.name}`,
      payload: { siteId: resource.siteId, resourceId, processingId: processing.id }, idempotencyKey: `cms-media:${processing.id}` });
    await tx.update(cmsMediaProcessing).set({ taskId: created.id }).where(eq(cmsMediaProcessing.id, processing.id));
    return created;
  });
  // The task center pending scanner recovers a committed job if the queue is temporarily unavailable.
  await enqueueAsyncTask(task.id).catch(() => undefined);
  return task;
}

export async function freezeCmsMediaForAssets(tx: DbExecutor, assetVersions: Record<string, number>): Promise<Record<string, CmsFrozenMedia>> {
  const ids = Object.values(assetVersions);
  if (!ids.length) return {};
  const rows = await tx.select().from(cmsMediaProcessing)
    .where(and(inArray(cmsMediaProcessing.assetVersionId, ids), eq(cmsMediaProcessing.status, 'success'))).orderBy(desc(cmsMediaProcessing.id));
  const byVersion = new Map<number, typeof rows[number]>();
  for (const row of rows) if (!byVersion.has(row.assetVersionId)) byVersion.set(row.assetVersionId, row);
  const frozen: Record<string, CmsFrozenMedia> = {};
  for (const [resourceId, versionId] of Object.entries(assetVersions)) {
    const row = byVersion.get(versionId);
    if (!row) continue;
    const result = freezeCmsMediaResult(row, versionId);
    if (result) frozen[resourceId] = result;
  }
  return frozen;
}

/** Batch enrich the existing list/selection surfaces without a query per card. */
export async function addCmsMediaToResources(resources: CmsResource[]): Promise<CmsResource[]> {
  if (!resources.length) return resources;
  const versions = await db.select().from(cmsAssetVersions).where(inArray(cmsAssetVersions.resourceId, resources.map((row) => row.id))).orderBy(desc(cmsAssetVersions.version));
  const assetVersions: Record<string, number> = {};
  for (const resource of resources) {
    const version = versions.find((row) => row.resourceId === resource.id && row.url === resource.url);
    if (version) assetVersions[String(resource.id)] = version.id;
  }
  const media = await freezeCmsMediaForAssets(db, assetVersions);
  return resources.map((resource) => ({ ...resource, assetVersionId: assetVersions[String(resource.id)], media: media[String(resource.id)] ?? null }));
}

export function cmsMediaDerivedFileIds(result: CmsMediaResult | null): string[] {
  return result ? [...result.variants.map((variant) => variant.fileId), ...(result.poster ? [result.poster.fileId] : [])] : [];
}

/** Called only after immutable revision / release references have been ruled out. */
export async function removeUnusedCmsMedia(tx: DbExecutor, assetVersionIds: number[]) {
  if (!assetVersionIds.length) return;
  const [subtitleUse] = await tx.select({ id: cmsMediaProcessing.id }).from(cmsMediaProcessing)
    .where(inArray(cmsMediaProcessing.subtitleVersionId, assetVersionIds)).limit(1);
  if (subtitleUse) throw new HTTPException(409, { message: '素材版本仍被媒体字幕引用，不能删除' });
  const processes = await tx.select().from(cmsMediaProcessing).where(inArray(cmsMediaProcessing.assetVersionId, assetVersionIds));
  const activeTasks = processes.flatMap((row) => row.taskId ? [row.taskId] : []);
  if (activeTasks.length) {
    const [active] = await tx.select({ id: asyncTasks.id }).from(asyncTasks).where(and(inArray(asyncTasks.id, activeTasks), inArray(asyncTasks.status, ['pending', 'running']))).limit(1);
    if (active) throw new HTTPException(409, { message: '素材仍有进行中的媒体任务，不能删除' });
  }
  await tx.delete(cmsMediaProcessing).where(inArray(cmsMediaProcessing.assetVersionId, assetVersionIds));
  await releaseManagedFiles(tx, processes.flatMap((row) => cmsMediaDerivedFileIds(row.result)));
}

export const cmsMediaUnfinishedCondition = (id: number) => and(eq(cmsMediaProcessing.id, id), isNull(cmsMediaProcessing.result));
