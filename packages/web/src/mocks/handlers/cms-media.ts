import { cmsResourceContract, type CmsMediaProcessing, type CmsMediaResult, type CmsResource } from '@arcbase/shared/cms';
import type { OutputOf } from '@arcbase/shared/core';
import { mockCmsResources } from '../data/cms';
import { mock } from '../utils/contract';
import { requireItem } from '../utils/crud';
import { badRequest, conflict } from '../utils/handlers';
import { mockDateTime } from '../utils/date';
import { createProgressingMockTask, refreshMockAsyncTask } from './async-tasks';

const versions: OutputOf<typeof cmsResourceContract.versions> = [];
const processes: CmsMediaProcessing[] = [];
const outputs = new Map<number, CmsMediaResult>();
let nextVersionId = 100_000;

export function mockCmsResourceVersions(resource: CmsResource) {
  const previous = versions.filter((version) => version.resourceId === resource.id);
  const latest = previous.at(-1);
  if (!latest || latest.url !== resource.url || latest.fileId !== resource.fileId) versions.push({
    id: nextVersionId++, resourceId: resource.id, version: (latest?.version ?? 0) + 1, url: resource.url, thumbUrl: resource.thumbUrl,
    fileId: resource.fileId, mimeType: resource.mimeType, size: resource.size, width: resource.width, height: resource.height,
    contentHash: `demo-${resource.id}-${nextVersionId}`, createdAt: resource.updatedAt,
  });
  return versions.filter((version) => version.resourceId === resource.id);
}

function refreshMedia(versionId: number) {
  for (const process of processes.filter((row) => row.assetVersionId === versionId)) {
    const task = process.taskId ? refreshMockAsyncTask(process.taskId) : undefined;
    if (task && process.status !== 'success') {
      process.status = task.status; process.errorMessage = task.errorMessage; process.updatedAt = task.updatedAt;
      if (task.status === 'success') process.result = structuredClone(outputs.get(process.id) ?? null);
    }
  }
  return processes.filter((row) => row.assetVersionId === versionId).at(-1) ?? null;
}

export function mockCmsResourceWithMedia(resource: CmsResource): CmsResource {
  const version = mockCmsResourceVersions(resource).at(-1)!;
  refreshMedia(version.id);
  return { ...resource, assetVersionId: version.id,
    media: processes.filter((row) => row.assetVersionId === version.id && row.status === 'success').at(-1)?.result ?? null };
}

export const cmsMediaHandlers = [
  mock(cmsResourceContract.media, ({ params, ok }) => {
    const resource = requireItem(mockCmsResources, params.id, '素材不存在');
    const version = mockCmsResourceVersions(resource).at(-1)!;
    return ok({ assetVersionId: version.id, processing: refreshMedia(version.id) });
  }),
  mock(cmsResourceContract.processMedia, ({ params, body, ok }) => {
    const resource = requireItem(mockCmsResources, params.id, '素材不存在');
    const resourceVersions = mockCmsResourceVersions(resource);
    const version = body.assetVersionId ? resourceVersions.find((row) => row.id === body.assetVersionId) : resourceVersions.at(-1);
    if (!version || !resource.fileId || !['image', 'audio', 'video'].includes(resource.type)) return badRequest('请选择已上传的图片或音视频文件版本', { status: 400 });
    const active = refreshMedia(version.id);
    if (active?.status === 'running' || active?.status === 'pending') return conflict('此文件版本已有进行中的处理任务', { status: 409 });
    const subtitle = body.subtitleResourceId ? mockCmsResources.find((row) => row.id === body.subtitleResourceId && row.siteId === resource.siteId) : null;
    if (body.subtitleResourceId && (!subtitle?.fileId || !/\.vtt$/i.test(subtitle.name) || resource.type === 'image')) return badRequest('请选择本站已上传的 .vtt 字幕文件', { status: 400 });
    const id = processes.length + 1;
    const task = createProgressingMockTask({ taskType: 'cms-media-processing', title: `媒体处理 · ${resource.name}`, totalItems: 5,
      payload: { siteId: resource.siteId, resourceId: resource.id, processingId: id, outcome: { processingId: id, assetVersionId: version.id } } });
    const width = resource.width ?? (resource.type === 'audio' ? null : 1280);
    const height = resource.height ?? (resource.type === 'audio' ? null : 720);
    const result: CmsMediaResult = { width, height, duration: resource.type === 'image' ? null : resource.media?.duration ?? 60,
      format: resource.mimeType, videoCodec: resource.type === 'video' ? 'h264' : null, audioCodec: resource.type === 'image' ? null : 'aac',
      focalPoint: body.focalPoint, variants: [], poster: resource.type === 'video' && resource.thumbUrl ? { fileId: crypto.randomUUID(), url: resource.thumbUrl, width: width!, height: height! } : null,
      subtitle: subtitle?.fileId ? { resourceId: subtitle.id, assetVersionId: mockCmsResourceVersions(subtitle).at(-1)!.id, fileId: subtitle.fileId, url: subtitle.url, language: body.subtitleLanguage, label: body.subtitleLabel } : null };
    outputs.set(id, result);
    processes.push({ id, resourceId: resource.id, assetVersionId: version.id, taskId: task.id, status: task.status, errorMessage: null,
      result: null, focalPoint: body.focalPoint, posterTime: body.posterTime, subtitleResourceId: body.subtitleResourceId,
      subtitleLanguage: body.subtitleLanguage, subtitleLabel: body.subtitleLabel, createdAt: mockDateTime(), updatedAt: mockDateTime() });
    return ok(task, '媒体处理任务已提交');
  }),
];
