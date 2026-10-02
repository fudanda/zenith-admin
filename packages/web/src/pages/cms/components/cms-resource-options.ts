import type { CmsResourceType } from '@arcbase/shared/cms';

export const CMS_ASSET_LABELS: Record<CmsResourceType, string> = { image: '图片', audio: '音频', video: '视频', document: '文档', other: '文件' };

export const cmsResourceAccept = (type?: CmsResourceType) => type === 'image' || type === 'audio' || type === 'video' ? `${type}/*` : undefined;
