/**
 * 频道消息内容的值对象与校验（text / image / news 三型共用）。
 *
 * 与 ChannelContentEditor.tsx（字段组件）配套；拆开是为了组件文件只导出组件，
 * 满足 Fast Refresh 约束。群发与自动回复共用，避免两处校验漂移。
 */
import type { ChannelMessageType } from '@arcbase/shared/messaging';

/** 三种消息类型的内容值合集；未用到的字段保持空串 */
export interface ChannelContentValue {
  /** text：可选标题；news：必填标题 */
  title: string;
  /** text：正文 */
  content: string;
  /** image：图片 URL */
  imageUrl: string;
  /** news：封面 / 摘要 / 跳转链接 / 富文本正文 */
  cover: string;
  summary: string;
  linkUrl: string;
  bodyHtml: string;
}

export const EMPTY_CHANNEL_CONTENT: ChannelContentValue = {
  title: '', content: '', imageUrl: '', cover: '', summary: '', linkUrl: '', bodyHtml: '',
};

/**
 * 内容校验，返回首个错误文案；通过返回 null。
 * requireCover：群发图文封面必填；自动回复封面可选。
 */
export function validateChannelContent(
  type: ChannelMessageType,
  value: ChannelContentValue,
  opts?: { requireCover?: boolean },
): string | null {
  if (type === 'text' && !value.content.trim()) return '请填写文本内容';
  if (type === 'image' && !value.imageUrl) return '请上传图片';
  if (type === 'news') {
    if (!value.title.trim()) return '图文消息请填写标题';
    if (opts?.requireCover && !value.cover) return '请上传图文封面';
  }
  return null;
}
