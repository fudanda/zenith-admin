import type { CmsResource } from '@arcbase/shared/cms';

export function cmsResourceThumbnail(resource: Pick<CmsResource, 'type' | 'url' | 'thumbUrl' | 'media'>): string | null {
  if (resource.type === 'image') return resource.media?.animated ? resource.url : resource.media?.variants[0]?.url ?? resource.thumbUrl ?? resource.url;
  return resource.media?.poster?.url ?? resource.thumbUrl;
}

export function cmsResourceMediaSummary(resource: Pick<CmsResource, 'width' | 'height' | 'media'>): string {
  const width = resource.media?.width ?? resource.width;
  const height = resource.media?.height ?? resource.height;
  return [width && height ? `${width} × ${height}` : '', resource.media?.duration ? formatCmsMediaDuration(resource.media.duration) : ''].filter(Boolean).join(' · ');
}

/** Browser metadata can report Infinity for live streams and NaN before it is loaded. */
export function formatCmsMediaDuration(seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const total = Math.max(1, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const remainder = total % 60;
  return [hours || null, String(minutes).padStart(2, '0'), String(remainder).padStart(2, '0')].filter((part) => part !== null).join(':');
}

export function isExternalCmsMediaUrl(value: string): boolean {
  try { const url = new URL(value); return url.protocol === 'https:' || url.protocol === 'http:'; } catch { return false; }
}

/** A late load event must not overwrite a newly selected media file or a manual duration. */
export function cmsMediaDurationFromMetadata(seconds: number, loadedValue: string, currentValue: unknown, currentDuration: unknown): string | null {
  if (loadedValue !== currentValue || String(currentDuration ?? '').trim()) return null;
  return formatCmsMediaDuration(seconds);
}
