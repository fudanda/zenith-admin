import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { and, eq } from 'drizzle-orm';
import { CMS_MEDIA_PROCESSING_TASK, CMS_MEDIA_VARIANT_WIDTHS, type CmsMediaResult } from '@arcbase/shared/cms';
import { db } from '../../db';
import { cmsMediaProcessing } from '../../db/schema/cms-media';
import { cmsAssetVersions } from '../../db/schema/cms-design';
import { asyncTasks } from '../../db/schema/tasks';
import { registerTaskHandler, TaskCancelledError, TaskNonRetryableError, type TaskRunContext } from '../../lib/task-center';
import { readFileContent, uploadManagedFile, deleteManagedFile } from '../files/files.service';
import { retainManagedFiles } from '../files/file-gc.service';
import { assertSiteAccess } from './cms-sites.service';
import { cmsMediaDerivedFileIds, cmsMediaUnfinishedCondition } from './cms-media.service';
import { makeCmsImageVariant, makeCmsVideoPoster, readCmsAvMetadata, readCmsImageMetadata, validateCmsWebVtt } from './cms-media-engine';

const MAX_MEDIA_BYTES = 512 * 1024 * 1024;

async function materializeManagedFile(fileId: string, path: string, maxBytes = MAX_MEDIA_BYTES) {
  const { stream } = await readFileContent(fileId);
  let bytes = 0;
  const bounded = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    bytes += chunk.length;
    callback(bytes > maxBytes ? new TaskNonRetryableError(`媒体文件超过处理上限（${maxBytes / 1024 / 1024} MB）`) : null, chunk);
  } });
  await pipeline(Readable.fromWeb(stream as import('node:stream/web').ReadableStream), bounded, createWriteStream(path, { flags: 'wx' }));
}

async function progress(ctx: TaskRunContext, processed: number, note: string) {
  if ((await ctx.progress({ processed, total: 5, note })).cancelRequested) throw new TaskCancelledError('媒体处理已取消');
}

export async function runCmsMediaProcessing(ctx: TaskRunContext) {
  const processingId = Number(ctx.payload.processingId);
  const [entry] = await db.select({ processing: cmsMediaProcessing, source: cmsAssetVersions }).from(cmsMediaProcessing)
    .innerJoin(cmsAssetVersions, eq(cmsAssetVersions.id, cmsMediaProcessing.assetVersionId))
    .where(and(eq(cmsMediaProcessing.id, processingId), eq(cmsMediaProcessing.taskId, ctx.taskId))).limit(1);
  if (!entry) throw new TaskNonRetryableError('媒体处理记录不存在');
  const { processing, source } = entry;
  await assertSiteAccess(source.siteId);
  // A restart of an already completed task cannot change results used by a revision.
  if (processing.status === 'success' && processing.result) return { processingId, assetVersionId: source.id };
  const ownedTask = and(eq(asyncTasks.id, ctx.taskId), eq(asyncTasks.dispatchToken, ctx.dispatchToken), eq(asyncTasks.status, 'running'));
  let directory: string | undefined;
  let committed = false;
  const generatedFiles: string[] = [];
  try {
    if (!source.fileId) throw new TaskNonRetryableError('外链素材无法处理，请先上传托管文件');
    await progress(ctx, 0, '读取不可变文件版本');
    await db.transaction(async (tx) => {
      const [owner] = await tx.select({ cancelRequested: asyncTasks.cancelRequested }).from(asyncTasks).where(ownedTask).for('update').limit(1);
      if (!owner || owner.cancelRequested) throw new TaskCancelledError('任务派发已变更或已取消');
      await tx.update(cmsMediaProcessing).set({ status: 'running', errorMessage: null }).where(cmsMediaUnfinishedCondition(processingId));
    });
    directory = await mkdtemp(join(tmpdir(), 'arcbase-cms-media-'));
    const sourcePath = join(directory, 'source.bin');
    await materializeManagedFile(source.fileId, sourcePath);
    const image = source.mimeType?.startsWith('image/') === true;
    const video = source.mimeType?.startsWith('video/') === true;
    const audio = source.mimeType?.startsWith('audio/') === true;
    if (!image && !video && !audio) throw new TaskNonRetryableError('此文件版本不是图片或音视频');
    const metadata = image ? await readCmsImageMetadata(sourcePath) : await readCmsAvMetadata(sourcePath);
    if (video && !metadata.videoCodec) throw new TaskNonRetryableError('视频文件中没有视频轨道');
    if (video && metadata.duration !== null && processing.posterTime >= metadata.duration) throw new TaskNonRetryableError('海报截取时间必须小于视频时长');
    await progress(ctx, 1, '已读取媒体信息');
    const result: CmsMediaResult = { ...metadata, focalPoint: processing.focalPoint, variants: [], poster: null, subtitle: null };
    const saveImage = async (output: { data: Buffer; info: { width: number; height: number } }, suffix: string) => {
      const file = await uploadManagedFile(new File([new Uint8Array(output.data)], `cms-media-${source.id}-${processingId}-${suffix}.webp`, { type: 'image/webp' }));
      generatedFiles.push(file.id);
      if (!file.url) throw new Error('生成图片未返回托管地址');
      return { fileId: file.id, url: file.url, width: output.info.width, height: output.info.height };
    };
    if (image && !result.animated) {
      for (const width of CMS_MEDIA_VARIANT_WIDTHS) {
        const variant = await saveImage(await makeCmsImageVariant(sourcePath, width), String(width));
        result.variants.push({ ...variant, targetWidth: width });
        await progress(ctx, 2, `已生成 ${width}px WebP 图片`);
      }
    } else if (video) {
      result.poster = await saveImage(await makeCmsVideoPoster(sourcePath, processing.posterTime, join(directory, 'poster.png')), 'poster');
    }
    await progress(ctx, 3, '检查字幕文件');
    if (processing.subtitleVersionId) {
      const [subtitle] = await db.select().from(cmsAssetVersions).where(and(eq(cmsAssetVersions.id, processing.subtitleVersionId), eq(cmsAssetVersions.siteId, source.siteId))).limit(1);
      if (!subtitle?.fileId) throw new TaskNonRetryableError('字幕文件版本不可用');
      const subtitlePath = join(directory, 'subtitle.vtt');
      await materializeManagedFile(subtitle.fileId, subtitlePath, 5 * 1024 * 1024);
      validateCmsWebVtt(await readFile(subtitlePath));
      result.subtitle = { resourceId: subtitle.resourceId, assetVersionId: subtitle.id, fileId: subtitle.fileId, url: subtitle.url, language: processing.subtitleLanguage, label: processing.subtitleLabel };
    }
    await progress(ctx, 4, '保存媒体处理结果');
    await db.transaction(async (tx) => {
      const [owner] = await tx.select({ cancelRequested: asyncTasks.cancelRequested }).from(asyncTasks).where(ownedTask).for('update').limit(1);
      if (!owner || owner.cancelRequested) throw new TaskCancelledError('任务派发已变更或已取消');
      const [saved] = await tx.update(cmsMediaProcessing).set({ result, status: 'success', errorMessage: null }).where(cmsMediaUnfinishedCondition(processingId)).returning({ id: cmsMediaProcessing.id });
      if (!saved) throw new TaskCancelledError('此处理已由其他任务完成');
      await retainManagedFiles(tx, cmsMediaDerivedFileIds(result));
    });
    committed = true;
    await progress(ctx, 5, result.animated ? '已保存动态图片信息，保留原图全部动画帧' : '媒体处理完成');
    return { processingId, assetVersionId: source.id, resourceId: source.resourceId };
  } catch (error) {
    await db.transaction(async (tx) => {
      const [owner] = await tx.select({ id: asyncTasks.id }).from(asyncTasks).where(ownedTask).for('update').limit(1);
      if (owner) await tx.update(cmsMediaProcessing).set({ status: error instanceof TaskCancelledError ? 'cancelled' : 'failed',
        errorMessage: error instanceof Error ? error.message : '媒体处理失败' }).where(cmsMediaUnfinishedCondition(processingId));
    });
    throw error;
  } finally {
    if (!committed) for (const fileId of generatedFiles) await deleteManagedFile(fileId).catch(() => undefined);
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function registerCmsMediaTaskHandlers() {
  registerTaskHandler({ taskType: CMS_MEDIA_PROCESSING_TASK, title: 'CMS 媒体处理', module: 'CMS内容管理', allowConcurrent: true,
    maxAttempts: 2, retryDelayMs: 5000, affinity: 'any', run: runCmsMediaProcessing });
}
