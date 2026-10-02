import { inArray, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { cmsSites, cmsContentTags, cmsTags } from '../../db/schema';
import type { CmsContentRow } from '../../db/schema';
import type { DbExecutor, DbTransaction } from '../../db/types';
import { ensureCmsChannelExists } from './cms-channels.service';
import type { CmsContentPublishSnapshot } from '@arcbase/shared/cms';
import type { AsyncTask } from '@arcbase/shared/tasks';
import { cmsSiteFencePayload } from './cms-site-publish-lock.service';
import { captureCmsContentPublishSnapshot } from './cms-content-publish-snapshot.service';
import { insertCmsPublishOutbox } from './cms-publish-outbox.service';

export async function insertContentPublishOutbox(
  tx: DbTransaction,
  site: typeof cmsSites.$inferSelect,
  row: CmsContentRow,
  action: string,
  deletePaths: readonly string[],
  options?: { build?: boolean; purged?: boolean; refreshChannelIds?: number[]; snapshot?: CmsContentPublishSnapshot },
): Promise<AsyncTask> {
  const captured = options?.snapshot
    ? { snapshot: { ...options.snapshot, build: options.build ?? options.snapshot.build, purged: options.purged ?? options.snapshot.purged } }
    : await captureCmsContentPublishSnapshot(tx, row, {
        build: options?.build,
        purged: options?.purged,
        refreshChannelIds: options?.refreshChannelIds,
      });
  const { expectedTemplateRefsRevision: _refsRevision, ...siteFence } = await cmsSiteFencePayload(tx, site);
  return insertCmsPublishOutbox(tx, {
    siteId: row.siteId,
    targetType: 'content',
    contentIds: [row.id],
    contentSnapshots: [captured.snapshot],
    deletePaths: [...new Set(deletePaths)].sort(),
    ...siteFence,
    reason: `内容 ${action} 静态发布`,
  }, `content:${row.id}:version:${row.version}:${action}`);
}

/** 单条 SQL 重算标签冗余计数（关联子查询，避免逐标签 COUNT 的 N+1 与竞态） */
export async function recalcTagContentCounts(executor: DbExecutor, tagIds: number[]): Promise<void> {
  if (tagIds.length === 0) return;
  // 外层列必须经 ${cmsTags}.id 显式表限定——sql`` 渲染裸 Column 不带表名，
  // 裸写会被内层作用域捕获（cmsContentTags 一旦增加 id 列即静默变成自比较）
  await executor.update(cmsTags)
    .set({ contentCount: sql<number>`(select count(*)::int from ${cmsContentTags} where ${cmsContentTags.tagId} = ${cmsTags}.id)` })
    .where(inArray(cmsTags.id, [...new Set(tagIds)]));
}

/** 校验栏目归属与类型（内容只能挂在本站点的列表栏目下） */
export async function ensureChannelForContent(siteId: number, channelId: number) {
  const channel = await ensureCmsChannelExists(channelId);
  if (channel.siteId !== siteId) throw new HTTPException(400, { message: '栏目不属于当前站点' });
  if (channel.type !== 'list') throw new HTTPException(400, { message: '只有列表栏目可以发布内容' });
  return channel;
}
