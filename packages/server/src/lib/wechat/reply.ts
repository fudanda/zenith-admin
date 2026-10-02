/** 微信被动回复 XML 构建（支持文本/图片/语音/视频/图文）。 */
import type { MpReplyContentType, MpReplyArticle } from '@arcbase/shared/mp';

export interface PassiveReply {
  contentType: MpReplyContentType;
  content?: string | null;
  mediaId?: string | null;
  newsArticles?: MpReplyArticle[] | null;
}

interface ReplyParty {
  toUser: string;
  fromUser: string;
}

/** 转义 CDATA 终止符，避免内容含 ]]> 破坏 XML 结构 */
const cdata = (s: string) => `<![CDATA[${(s ?? '').replaceAll(']]>', ']]]]><![CDATA[>')}]]>`;

/** 构建被动回复 XML（自动按 contentType 生成对应结构，news 内嵌 Articles 列表） */
export function buildPassiveReplyXml(party: ReplyParty, reply: PassiveReply): string {
  const createTime = Math.floor(Date.now() / 1000);
  const header = `<ToUserName>${cdata(party.toUser)}</ToUserName><FromUserName>${cdata(party.fromUser)}</FromUserName><CreateTime>${createTime}</CreateTime>`;
  switch (reply.contentType) {
    case 'image':
      return `<xml>${header}<MsgType>${cdata('image')}</MsgType><Image><MediaId>${cdata(reply.mediaId ?? '')}</MediaId></Image></xml>`;
    case 'voice':
      return `<xml>${header}<MsgType>${cdata('voice')}</MsgType><Voice><MediaId>${cdata(reply.mediaId ?? '')}</MediaId></Voice></xml>`;
    case 'video': {
      const title = reply.content ? `<Title>${cdata(reply.content)}</Title>` : '';
      return `<xml>${header}<MsgType>${cdata('video')}</MsgType><Video><MediaId>${cdata(reply.mediaId ?? '')}</MediaId>${title}</Video></xml>`;
    }
    case 'news': {
      const arts = (reply.newsArticles ?? []).slice(0, 8);
      const items = arts
        .map((a) => `<item><Title>${cdata(a.title)}</Title><Description>${cdata(a.description ?? '')}</Description><PicUrl>${cdata(a.picUrl ?? '')}</PicUrl><Url>${cdata(a.url)}</Url></item>`)
        .join('');
      return `<xml>${header}<MsgType>${cdata('news')}</MsgType><ArticleCount>${arts.length}</ArticleCount><Articles>${items}</Articles></xml>`;
    }
    case 'text':
    default:
      return `<xml>${header}<MsgType>${cdata('text')}</MsgType><Content>${cdata(reply.content ?? '')}</Content></xml>`;
  }
}

/** 将被动回复摘要为一行文本（用于会话落库展示） */
export function summarizePassiveReply(reply: PassiveReply): string {
  switch (reply.contentType) {
    case 'image': return '[图片消息]';
    case 'voice': return '[语音消息]';
    case 'video': return reply.content ? `[视频] ${reply.content}` : '[视频消息]';
    case 'news': return `[图文] ${(reply.newsArticles ?? []).map((a) => a.title).join('、')}`.trim();
    case 'text':
    default: return reply.content ?? '';
  }
}
