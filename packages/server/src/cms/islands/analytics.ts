import { CmsTracker, type CmsTrackerConfig } from '@arcbase/analytics-sdk/cms-tracker';
import type { CmsAttributionContext } from '@arcbase/shared/cms';
import { readMeta } from './shared/meta';

const trackers = new WeakMap<Document, CmsTracker>();

/** The renderer signs immutable page facts. Preview pages never initialize visitor storage or emit events. */
export function runAnalytics(doc: Document = document): CmsTracker | undefined {
  const existing = trackers.get(doc);
  if (existing) return existing;
  const contextToken = readMeta('cms-telemetry-context', doc);
  const raw = readMeta('cms-telemetry-config', doc);
  if (!contextToken || !raw || !doc.defaultView) return undefined;
  let config: CmsTrackerConfig;
  try { config = JSON.parse(raw) as CmsTrackerConfig; } catch { return undefined; }
  if (!config || config.environment !== 'live' || !Number.isSafeInteger(config.siteId) || config.siteId <= 0 || !config.canonicalPath?.startsWith('/')) return undefined;
  const tracker = new CmsTracker({ document: doc, contextToken, config });
  trackers.set(doc, tracker);
  tracker.start();
  return tracker;
}

export function getCmsAttributionContext(doc: Document = document): CmsAttributionContext | undefined {
  return (trackers.get(doc) ?? runAnalytics(doc))?.getAttributionContext();
}

/** Only non-sensitive error codes are recorded; submitted field values never enter telemetry. */
export function trackCmsFormError(doc: Document, interactionId: number, failureCode: string, interactionName?: string): void {
  const tracker = trackers.get(doc);
  tracker?.track('cms.form_error', { targetId: `interaction:${interactionId}`, interactionId, interactionName: interactionName?.slice(0, 255), failureCode: failureCode.slice(0, 128) });
}

export function stopCmsAnalytics(doc: Document = document): void {
  trackers.get(doc)?.dispose(); trackers.delete(doc);
}
