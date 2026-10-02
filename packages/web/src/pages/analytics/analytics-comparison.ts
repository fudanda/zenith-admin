import { useState } from 'react';
import type { AnalyticsComparison, AnalyticsDrillContext } from '@zenith/shared/analytics';

/** 分群对比至少要选一个分群，否则请求体过不了 schema 校验 */
export function isComparisonReady(comparison: AnalyticsComparison): boolean {
  return comparison.type !== 'segments' || comparison.segmentIds.length > 0;
}

/** 下钻抽屉的开合状态，供漏斗/留存复用 */
export function useDrillSheet() {
  const [context, setContext] = useState<AnalyticsDrillContext | null>(null);
  const [meta, setMeta] = useState<{ title: string; description?: string }>({ title: '' });
  return {
    context,
    title: meta.title,
    description: meta.description,
    open: (next: AnalyticsDrillContext, title: string, description?: string) => {
      setMeta({ title, description });
      setContext(next);
    },
    close: () => setContext(null),
  };
}
