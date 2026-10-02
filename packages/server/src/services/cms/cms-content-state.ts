import type { CmsContentRow } from '../../db/schema';
import type { CmsContentStatus } from '@arcbase/shared/cms';

export const CMS_CONTENT_STATUS_TRANSITIONS = {
  submit: ['draft', 'rejected'],
  publish: ['draft', 'pending', 'rejected', 'offline'],
  reject: ['pending'],
  offline: ['published'],
} as const satisfies Record<string, readonly CmsContentStatus[]>;

export type CmsContentTransitionAction = keyof typeof CMS_CONTENT_STATUS_TRANSITIONS;

export function canTransitionCmsContentStatus(
  current: CmsContentStatus,
  action: CmsContentTransitionAction,
): boolean {
  return (CMS_CONTENT_STATUS_TRANSITIONS[action] as readonly CmsContentStatus[]).includes(current);
}

/**
 * 单一的公开可见性判定，供会员历史、增量同步和渲染映射等内存路径复用。
 * SQL 查询仍应同时带上等价的条件；这个函数用于防止已加载的过期行再次被输出。
 */
export function isCmsContentPubliclyVisible(
  row: Pick<CmsContentRow, 'status' | 'deletedAt' | 'archivedAt' | 'expireAt'>,
  now = new Date(),
): boolean {
  return row.status === 'published'
    && row.deletedAt == null
    && row.archivedAt == null
    && (row.expireAt == null || row.expireAt > now);
}
