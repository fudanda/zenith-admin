/**
 * CMS 正文辅助（纯函数，无 DB / 无外部依赖）：
 * 供内容保存管线提取封面首图，以及给主题渲染准备附件展示数据。
 */
import type { CmsContentAttachment } from '@arcbase/shared/cms';

/** 提取正文 HTML 中第一张图片地址；无图返回 null */
export function extractFirstImage(body: string | null | undefined): string | null {
  if (!body) return null;
  const match = /<img\b[^>]*?\bsrc\s*=\s*(["'])(.*?)\1/i.exec(body);
  const url = match?.[2]?.trim();
  if (!url) return null;
  // data: URI 体积不可控，不作为封面
  if (/^data:/i.test(url)) return null;
  return url.slice(0, 500);
}

const ATTACHMENT_EXT_RE = /\.([a-z0-9]{1,10})(?:[?#].*)?$/i;

/** 从下载地址推断扩展名（小写，不含点）；推断不出返回空串 */
export function guessAttachmentExt(url: string): string {
  return ATTACHMENT_EXT_RE.exec(url)?.[1]?.toLowerCase() ?? '';
}

/**
 * 附件列表规范化：去空、补扩展名、按 sort 稳定排序后重排序号。
 * 入参已过 Zod 校验，这里只做落库前的一致性整理。
 */
export function normalizeAttachments(
  input: readonly CmsContentAttachment[] | null | undefined,
): CmsContentAttachment[] {
  if (!input || input.length === 0) return [];
  return input
    .filter((item) => item.name.trim() !== '' && item.url.trim() !== '')
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.sort - b.item.sort || a.index - b.index)
    .map(({ item }, index) => ({
      name: item.name.trim(),
      url: item.url.trim(),
      size: Math.max(0, Math.trunc(item.size)),
      ext: (item.ext.trim() || guessAttachmentExt(item.url)).toLowerCase(),
      sort: index,
    }));
}
