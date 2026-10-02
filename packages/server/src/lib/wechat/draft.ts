import { wechatApiPost } from './api';
import type { MpCredential } from './api';
import type { MpArticle } from '@arcbase/shared/mp';

interface DraftAddResponse {
  errcode?: number;
  errmsg?: string;
  media_id?: string;
}

/** 新增图文草稿到微信草稿箱，返回草稿 media_id */
export async function addWechatDraft(account: MpCredential, articles: MpArticle[]): Promise<string> {
  const payload = articles.map((a) => ({
    title: a.title,
    author: a.author ?? '',
    digest: a.digest ?? '',
    content: a.content,
    content_source_url: a.contentSourceUrl ?? '',
    thumb_media_id: a.thumbMediaId ?? '',
    show_cover_pic: a.showCoverPic ? 1 : 0,
    need_open_comment: 0,
    only_fans_can_comment: 0,
  }));
  const data = await wechatApiPost<DraftAddResponse>(account, '/cgi-bin/draft/add', { articles: payload });
  return data.media_id ?? '';
}
