import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import dayjs from 'dayjs';
import type { CmsPublishArtifactStatus, CmsPublishTargetType } from '@arcbase/shared/cms';
import { db } from '../../db';
import { cmsPublishArtifacts } from '../../db/schema';

export interface CmsPublishTrackingContext {
  taskId: number;
  siteId: number;
  publicRevision: number;
  targetType: CmsPublishTargetType;
  contentId?: number | null;
  channelId?: number | null;
  pageId?: number | null;
  themeCode?: string | null;
  /** 站点对外 origin（用于产物 URL），无绑定域名时为 null */
  origin: string | null;
  onArtifact?: (artifact: {
    path: string;
    status: CmsPublishArtifactStatus;
    error: string | null;
    size: number | null;
  }) => Promise<void>;
}

const tracker = new AsyncLocalStorage<CmsPublishTrackingContext>();

export function withCmsPublishArtifactTracking<T>(
  context: CmsPublishTrackingContext,
  fn: () => T | Promise<T>,
): Promise<T> {
  return Promise.resolve(tracker.run(context, fn));
}


function artifactUrl(origin: string | null | undefined, publicPath: string): string | null {
  if (!origin) return null;
  const suffix = publicPath ? `/${publicPath}` : '/';
  return `${origin.replace(/\/+$/, '')}${suffix}`;
}

export async function recordCmsPublishArtifact(input: {
  relPath: string;
  status: CmsPublishArtifactStatus;
  content?: string | Buffer | null;
  error?: string | null;
}): Promise<void> {
  const context = tracker.getStore();
  if (!context) return;
  const normalizedPath = input.relPath.replaceAll('\\', '/').replace(/^\/+/, '');
  // Directory routes are written to `<dir>/index.html` on disk. Store the
  // same canonical key in the artifact table so freshness checks cannot miss
  // a failed or stale directory build.
  const relPath = normalizedPath.endsWith('/')
    ? `${normalizedPath}index.html`
    : normalizedPath || 'index.html';
  const bytes = input.content == null
    ? null
    : Buffer.isBuffer(input.content) ? input.content : Buffer.from(input.content, 'utf8');
  const size = bytes?.length ?? null;
  const checksum = bytes ? createHash('sha256').update(bytes).digest('hex') : null;
  const now = dayjs().toDate();
  await db.insert(cmsPublishArtifacts).values({
    taskId: context.taskId,
    siteId: context.siteId,
    targetType: context.targetType,
    contentId: context.contentId ?? null,
    channelId: context.channelId ?? null,
    pageId: context.pageId ?? null,
    themeCode: context.themeCode ?? null,
    path: relPath,
    url: artifactUrl(context.origin, relPath),
    checksum,
    size,
    publicRevision: context.publicRevision,
    status: input.status,
    error: input.error?.slice(0, 2000) ?? null,
    generatedAt: input.status === 'generated' ? now : null,
  }).onConflictDoUpdate({
    target: [cmsPublishArtifacts.taskId, cmsPublishArtifacts.path],
    set: {
      contentId: sql`excluded.content_id`,
      channelId: sql`excluded.channel_id`,
      pageId: sql`excluded.page_id`,
      themeCode: sql`excluded.theme_code`,
      url: sql`excluded.url`,
      checksum: sql`excluded.checksum`,
      size: sql`excluded.size`,
      publicRevision: sql`excluded.public_revision`,
      status: sql`excluded.status`,
      error: sql`excluded.error`,
      generatedAt: sql`excluded.generated_at`,
      updatedAt: now,
    },
  });
  await context.onArtifact?.({
    path: relPath,
    status: input.status,
    error: input.error ?? null,
    size,
  });
}
