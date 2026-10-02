import { and, eq, sql } from 'drizzle-orm';
import type { CmsContentPublishSnapshot } from '@arcbase/shared/cms';
import type { DbExecutor } from '../../db/types';
import {
  asyncTasks,
  cmsChannels,
  cmsPublishArtifacts,
  type CmsContentRow,
} from '../../db/schema';
import { contentUrl, splitBodyPages } from './cms-render.service';
import type { CmsUrlChannel } from './cms-urls';

export function buildCmsContentSnapshotPaths(
  content: Pick<CmsContentRow, 'id' | 'slug' | 'staticPath' | 'publishedAt' | 'createdAt'>,
  channel: CmsUrlChannel,
  bodyPages: number,
): string[] {
  return Array.from({ length: bodyPages }, (_, index) =>
    contentUrl('', channel, content, index + 1).replace(/^\/+/, ''));
}

async function bodyPageCount(_executor: DbExecutor, row: CmsContentRow): Promise<number> {
  return splitBodyPages(row.body).length;
}

export async function captureCmsContentPublishSnapshot(
  executor: DbExecutor,
  row: CmsContentRow,
  options?: {
    build?: boolean;
    purged?: boolean;
    includeExistingArtifacts?: boolean;
    refreshChannelIds?: number[];
  },
): Promise<{ snapshot: CmsContentPublishSnapshot; deletePaths: string[] }> {
  const [channel] = await executor.select({ id: cmsChannels.id, path: cmsChannels.path, detailPathRule: cmsChannels.detailPathRule })
    .from(cmsChannels)
    .where(eq(cmsChannels.id, row.channelId)).limit(1);
  if (!channel) throw new Error(`内容 #${row.id} 的栏目不存在`);
  const bodyPages = await bodyPageCount(executor, row);
  const paths = buildCmsContentSnapshotPaths(row, channel, bodyPages);
  const existing = options?.includeExistingArtifacts
    ? await executor.select({ path: cmsPublishArtifacts.path }).from(cmsPublishArtifacts).where(and(
        eq(cmsPublishArtifacts.siteId, row.siteId),
        eq(cmsPublishArtifacts.contentId, row.id),
        eq(cmsPublishArtifacts.status, 'generated'),
      ))
    : [];
  const pendingTasks = options?.includeExistingArtifacts
    ? await executor.select({ payload: asyncTasks.payload }).from(asyncTasks).where(and(
        eq(asyncTasks.taskType, 'cms-publish-build'),
        sql`${asyncTasks.status} in ('pending', 'running')`,
        sql`(${asyncTasks.payload}->'contentIds') @> ${JSON.stringify([row.id])}::jsonb`,
      ))
    : [];
  const pendingPaths = pendingTasks.flatMap(({ payload }) => {
    const task = payload as unknown as { deletePaths?: unknown; contentSnapshots?: unknown };
    const deleted = Array.isArray(task.deletePaths) ? task.deletePaths.filter((item): item is string => typeof item === 'string') : [];
    const built = Array.isArray(task.contentSnapshots)
      ? task.contentSnapshots.flatMap((snapshot) => {
          if (!snapshot || typeof snapshot !== 'object') return [];
          const list = (snapshot as { paths?: unknown }).paths;
          return Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : [];
        })
      : [];
    return [...deleted, ...built];
  });
  const deletePaths = [...new Set([
    ...paths,
    ...existing.map((artifact) => artifact.path),
    ...pendingPaths,
  ])].sort();
  return {
    snapshot: {
      contentId: row.id,
      siteId: row.siteId,
      contentVersion: row.version,
      channelId: row.channelId,
      channelPath: channel.path,
      slug: String(row.slug ?? row.id),
      bodyPages,
      build: options?.build ?? (row.status === 'published' && !row.deletedAt && !row.externalLink?.trim()),
      purged: options?.purged,
      paths,
      refreshChannelIds: [...new Set(options?.refreshChannelIds ?? [row.channelId])].sort((a, b) => a - b),
    },
    deletePaths,
  };
}
