import { load } from 'cheerio';
import { isValidCmsAssetUrl, type CmsFrozenMedia } from '@arcbase/shared/cms';

export function frozenCmsMediaForUrl(url: string | null | undefined, media: Record<string, CmsFrozenMedia> | undefined) {
  if (!url) return undefined;
  return Object.entries(media ?? {}).find(([id, value]) => value.sourceUrl === url || url === `cms-res://${id}`)?.[1];
}
export function frozenCmsImageAttributes(url: string | null | undefined, media: Record<string, CmsFrozenMedia> | undefined) {
  const frozen = frozenCmsMediaForUrl(url, media);
  if (!frozen) return {};
  const variants = [...new Map(frozen.variants.filter((item) => isValidCmsAssetUrl(item.url)).map((item) => [item.width, item])).values()].sort((a, b) => a.width - b.width);
  return { srcSet: variants.length ? variants.map((item) => `${item.url} ${item.width}w`).join(', ') : undefined,
    objectPosition: `${frozen.focalPoint.x * 100}% ${frozen.focalPoint.y * 100}%` };
}
export function renderCmsFrozenBody(html: string, media: Record<string, CmsFrozenMedia> | undefined) {
  if (!media || !Object.keys(media).length) return html;
  const $ = load(html, null, false);
  $('img').each((_index, node) => {
    const attrs = frozenCmsImageAttributes($(node).attr('src'), media);
    if (attrs.srcSet) $(node).attr('srcset', attrs.srcSet).attr('sizes', '(max-width: 768px) 100vw, 800px');
  });
  return $.html();
}
export function cmsDurationLabel(seconds: number | null | undefined) {
  if (seconds == null || !Number.isFinite(seconds)) return null;
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
