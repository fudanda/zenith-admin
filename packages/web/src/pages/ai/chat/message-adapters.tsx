import type { Message as AIChatMessage } from '@douyinfe/semi-ui/lib/es/aiChatDialogue';
import type { AiMessage } from '@arcbase/shared/ai';
import { fileContract } from '@arcbase/shared/platform';
import { config } from '@/config';
import { urlOf } from '@/lib/contract-query';

/**
 * AI 消息 → Semi AIChatDialogue Message 适配层。
 * 智能对话页与审计/反馈上下文查看器共用同一实现，保证渲染形态不偏移。
 */

export type ChatMessage = Omit<AIChatMessage, 'role' | 'content' | 'status' | 'createdAt'> & {
  id: string;
  role: 'system' | 'user' | 'assistant';
  content: NonNullable<AIChatMessage['content']>;
  createdAt: number;
  status?: 'completed' | 'in_progress' | 'failed';
};

export const AI_AVATAR = 'https://lf3-static.bytednsdoc.com/obj/eden-cn/ptlz_zlp/ljhwZthlaukjlkulzlp/other/logo.png';

/** 工具调用过程（SSE tool_call 事件） */
export interface ToolCallDisplay {
  name: string;
  arguments: string;
  result: string;
}

/** 知识库引用（SSE references 事件） */
export interface KbRefDisplay {
  docName: string;
  content: string;
  score: number;
}

/** 组装 assistant 消息内容：思维链折叠面板 + 工具调用过程 + 正文 + 知识库引用 */
export function buildAssistantContent(
  text: string,
  reasoning: string | null | undefined,
  reasoningDone: boolean,
  toolCalls?: ToolCallDisplay[],
  references?: KbRefDisplay[],
): NonNullable<AIChatMessage['content']> {
  const hasExtras = !!reasoning || (toolCalls?.length ?? 0) > 0 || (references?.length ?? 0) > 0;
  if (!hasExtras) return text;
  const items: Record<string, unknown>[] = [];
  if (reasoning) {
    items.push({
      type: 'reasoning',
      status: reasoningDone ? 'completed' : 'in_progress',
      content: [{ type: 'reasoning_text', text: reasoning }],
    });
  }
  for (const tc of toolCalls ?? []) {
    items.push({ type: 'function_call', status: 'completed', name: tc.name, arguments: tc.arguments, output: tc.result });
  }
  items.push({ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text }] });
  if (references?.length) {
    items.push({ type: 'kb_references', refs: references });
  }
  return items as NonNullable<AIChatMessage['content']>;
}

/** 组装 user 消息内容：Semi 官方多模态形态（input_text 文本 + input_image 图片附件） */
export function buildUserContent(text: string, imageUrls: string[]): NonNullable<AIChatMessage['content']> {
  if (imageUrls.length === 0) return text;
  const items: Record<string, unknown>[] = [{
    type: 'message',
    content: [
      ...(text ? [{ type: 'input_text', text }] : []),
      ...imageUrls.map((url) => ({ type: 'input_image', image_url: url })),
    ],
  }];
  return items as NonNullable<AIChatMessage['content']>;
}

/** DB 消息 DTO → Semi Message（思维链 / 图片 / 模型标注 / 反馈状态） */
export function convertApiMessage(m: AiMessage): ChatMessage {
  return {
    id: `api-${m.id}`,
    role: m.role,
    content: m.role === 'assistant'
      ? buildAssistantContent(m.content, m.reasoning, true, m.toolCalls ?? undefined, m.references ?? undefined)
      : buildUserContent(m.content, (m.images ?? []).map((id) => `${config.apiBaseUrl}${urlOf(fileContract.content, { params: { id } })}`)),
    // ⚠️ 不能设 output_text:Semi 对数组 content 优先渲染 output_text 纯文本,
    // 会整体短路 reasoning / 工具调用 / 引用等块(复制与朗读经 extractPlainText 提取)
    ...(m.role === 'assistant' && m.model && { model: m.model }),
    createdAt: new Date(m.createdAt).getTime(),
    status: 'completed',
    // 映射 DB feedback 字段到 Semi AIChatDialogue 的 like/dislike 显示状态
    ...(m.feedback === 1  && { like: true }),
    ...(m.feedback === -1 && { dislike: true }),
  };
}

/** 消息时间：完整年月日时分秒 */
export function formatMessageTime(ts: number) {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 提取消息纯文本（数组 content 时取 message 项内的 output_text / input_text 文本） */
export function extractPlainText(msg: ChatMessage): string {
  if (typeof msg.content === 'string') return msg.content;
  if (!Array.isArray(msg.content)) return '';
  const texts: string[] = [];
  for (const item of msg.content as Record<string, unknown>[]) {
    if (item.type !== 'message') continue;
    const inner = item.content;
    if (typeof inner === 'string') { texts.push(inner); continue; }
    if (!Array.isArray(inner)) continue;
    for (const part of inner as Record<string, unknown>[]) {
      if ((part.type === 'output_text' || part.type === 'input_text') && typeof part.text === 'string') {
        texts.push(part.text);
      }
    }
  }
  return texts.join('\n');
}
