import type { ReportResourceType } from '@arcbase/shared/report';
import { db } from '../../db';
import { reportAssetUsageLogs } from '../../db/schema';
import { currentUserOrNull } from '../../lib/context';
import logger from '../../lib/logger';

export async function recordReportAssetUsage(input: {
  tenantId: number | null;
  resourceType: ReportResourceType;
  resourceId: number;
  action: 'view' | 'query' | 'export' | 'embed' | 'share';
  scene?: string | null;
  durationMs?: number | null;
  rowCount?: number;
  byteSize?: number;
  success?: boolean;
}): Promise<void> {
  const user = currentUserOrNull();
  if (!user) return;
  try {
    await db.insert(reportAssetUsageLogs).values({
      tenantId: input.tenantId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      userId: user.userId,
      action: input.action,
      scene: input.scene?.slice(0, 64) ?? null,
      durationMs: input.durationMs == null ? null : Math.max(0, Math.round(input.durationMs)),
      rowCount: Math.max(0, Math.trunc(input.rowCount ?? 0)),
      byteSize: Math.max(0, Math.trunc(input.byteSize ?? 0)),
      success: input.success ?? true,
    });
  } catch (error) {
    logger.warn('记录报表资产使用事件失败', {
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      err: error instanceof Error ? error.message : String(error),
    });
  }
}
