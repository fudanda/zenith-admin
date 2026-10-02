import { HTTPException } from 'hono/http-exception';
import { currentUser } from '../../lib/context';
import { getRawDefaultProviderConfig, getRawProviderConfig } from './ai-providers.service';
import { getRawUserAiConfigById } from './user-ai-config.service';
import { buildPreferencePrompt } from './ai-user-settings.service';
import { streamAgentChat, chatOnce } from '../../lib/ai/mastra-chat';
import { getMastraTools } from '../../lib/ai/tools';
import { acquireProviderSlot } from '../../lib/ai/reliability';
import { updateConversationTitle } from './ai-conversations.service';
import logger from '../../lib/logger';
import type { ChatMessage, StreamChunk } from '../../lib/ai/stream-types';
import type { ModelChainEntry } from '../../lib/ai/mastra-models';
import type { AiModelCapabilities, AiModelSettings } from '@arcbase/shared/ai';

export type { StreamChunk };

/** 对话快照:providerId + 实际模型 + 配置来源 */
export interface ProviderSnapshot {
  providerId: string;
  model: string;
  configId?: number;
}

type ResolvedStreamConfig = {
  /** 模型降级链(第一项为主模型,fallbacks 已解析) */
  chain: ModelChainEntry[];
  capabilities: AiModelCapabilities | null;
  snapshot: ProviderSnapshot;
  /** 配置级系统提示词(对话覆盖优先) */
  systemPrompt: string | null;
  /** 并发流上限 */
  maxConcurrent?: number | null;
};

type SystemProviderConfig = Awaited<ReturnType<typeof getRawProviderConfig>>;

/** 校验 modelOverride 属于该配置声明的模型集合，返回最终生效模型 */
function applyModelOverride(cfg: { defaultModel: string; models: string[] }, modelOverride?: string): string {
  if (!modelOverride || modelOverride === cfg.defaultModel) return cfg.defaultModel;
  if (!cfg.models.includes(modelOverride)) {
    throw new HTTPException(400, { message: '所选模型不在该服务商配置的模型列表中' });
  }
  return modelOverride;
}

/** 系统配置 → 降级链:主模型 + fallbacks 引用逐级解析(禁用/失效项跳过,不做链式递归) */
async function buildSystemChain(systemConfig: SystemProviderConfig, model: string): Promise<ModelChainEntry[]> {
  const chain: ModelChainEntry[] = [{
    source: systemConfig,
    model,
    maxRetries: 1,
    modelSettings: systemConfig.modelSettings,
  }];
  for (const fb of systemConfig.fallbacks ?? []) {
    if (fb.configId === systemConfig.id) continue;
    try {
      const fbCfg = await getRawProviderConfig(fb.configId);
      if (!fbCfg.isEnabled) continue;
      const fbModel = fbCfg.models.includes(fb.model) ? fb.model : fbCfg.defaultModel;
      chain.push({ source: fbCfg, model: fbModel, maxRetries: fb.maxRetries ?? 1, modelSettings: fbCfg.modelSettings });
    } catch {
      // 降级目标已被删除:跳过该级
    }
  }
  return chain;
}

async function mapSystemStreamConfig(
  systemConfig: SystemProviderConfig,
  modelOverride?: string,
): Promise<ResolvedStreamConfig> {
  const model = applyModelOverride(systemConfig, modelOverride);
  return {
    chain: await buildSystemChain(systemConfig, model),
    capabilities: systemConfig.capabilities ?? null,
    maxConcurrent: systemConfig.maxConcurrent,
    systemPrompt: null,
    snapshot: {
      providerId: systemConfig.providerId,
      model,
      configId: systemConfig.id,
    },
  };
}

/**
 * 解析当前请求应使用的 AI 配置（未指定时使用系统默认配置）
 */
async function resolveStreamConfig(modelOverride?: string): Promise<ResolvedStreamConfig> {
  const sysCfg = await getRawDefaultProviderConfig();
  if (!sysCfg) throw new HTTPException(503, { message: '系统未配置 AI 服务商，请联系管理员' });
  return mapSystemStreamConfig(sysCfg, modelOverride);
}

/**
 * 指定 configId 使用系统中的某个 AI 配置
 */
async function resolveStreamConfigById(configId: number, modelOverride?: string): Promise<ResolvedStreamConfig> {
  const sysCfg = await getRawProviderConfig(configId);
  if (!sysCfg.isEnabled) throw new HTTPException(400, { message: '该 AI 配置已禁用，请选择其他模型' });
  return mapSystemStreamConfig(sysCfg, modelOverride);
}

async function resolveStreamConfigForUser(userConfigId: number, modelOverride?: string): Promise<ResolvedStreamConfig> {
  const user = currentUser();
  const userCfg = await getRawUserAiConfigById(userConfigId, user.userId);
  if (!userCfg?.isEnabled || !userCfg.apiKey || userCfg.models.length === 0 || !userCfg.defaultModel) {
    throw new HTTPException(400, { message: '用户 AI 配置不完整，请先在设置中填写 API Key 与模型列表' });
  }
  if (userCfg.providerId === 'custom' && !userCfg.baseUrl) {
    throw new HTTPException(400, { message: '自定义服务商必须填写 API 地址' });
  }
  // 与系统配置同款约束与映射(applyModelOverride + buildModelChain 单一路径);用户配置无降级链
  const model = applyModelOverride({ defaultModel: userCfg.defaultModel, models: userCfg.models }, modelOverride);
  return {
    chain: [{
      source: {
        providerId: userCfg.providerId,
        baseUrl: userCfg.baseUrl,
        apiKey: userCfg.apiKey,
        headers: userCfg.headers,
        modelSettings: userCfg.modelSettings,
        providerOptions: userCfg.providerOptions,
      },
      model,
      maxRetries: 1,
      modelSettings: userCfg.modelSettings,
    }],
    capabilities: userCfg.capabilities ?? null,
    systemPrompt: userCfg.systemPrompt ?? null,
    snapshot: { providerId: userCfg.providerId, model },
  };
}

export interface StreamAiChatOptions {
  signal?: AbortSignal;
  systemPromptOverride?: string | null;
  /** 多模型配置下选择的具体模型 */
  model?: string;
  /** 是否启用内置工具（还需配置 capabilities.tools 声明支持函数调用） */
  enableTools?: boolean;
  /** 模型设置覆盖（智能体的 modelSettings,合并到主模型条目） */
  modelSettingsOverride?: AiModelSettings | null;
  /** 工具白名单（智能体勾选的工具集；undefined = 全部，[] = 无） */
  toolFilter?: string[] | null;
  /** Mastra Memory 作用域(提供则上下文由 Memory 引擎管理,messages 仅传当轮输入) */
  memory?: { thread: string; resource: string; workingMemoryEnabled?: boolean };
  /** 一次性上下文消息(知识库检索结果等,不写入记忆) */
  context?: ChatMessage[];
}

export type StreamAiChatChunk = StreamChunk
  | { type: 'tool_result'; name: string; arguments: string; result: string; durationMs: number }
  | { type: 'failover'; from: string; to: string };

/**
 * 统一聊天流（Mastra Agent 执行）：解析配置 → 组装 system prompt →
 * 构建模型降级链与工具集 → Agent 流式生成。
 * 工具循环与主备切换（5xx/限流/超时按 fallbacks 链自动降级）由 Mastra 内部完成；
 * 服务商配置了并发上限时先获取信号量（超时报错）。
 */
export async function* streamAiChat(
  messages: ChatMessage[],
  configSource?: 'system' | 'user',
  configId?: number,
  options?: StreamAiChatOptions,
): AsyncGenerator<StreamAiChatChunk & { snapshot?: ProviderSnapshot }> {
  let resolved: ResolvedStreamConfig;
  if (configSource === 'user' && configId) {
    resolved = await resolveStreamConfigForUser(configId, options?.model);
  } else if (configId) {
    resolved = await resolveStreamConfigById(configId, options?.model);
  } else {
    resolved = await resolveStreamConfig(options?.model);
  }

  // 对话级提示词模板：覆盖配置级 systemPrompt
  let systemPrompt = resolved.systemPrompt;
  const override = options?.systemPromptOverride;
  if (typeof override === 'string' && override.trim()) {
    systemPrompt = override;
  }

  // 个人指令（Custom Instructions）：追加到 system prompt 末尾
  try {
    const user = currentUser();
    const preference = await buildPreferencePrompt(user.userId);
    if (preference) {
      systemPrompt = systemPrompt ? `${systemPrompt}\n\n${preference}` : preference;
    }
  } catch { /* 无登录上下文（如内部调用）时跳过 */ }

  // 模型设置覆盖(智能体):合并到主模型条目(优先级高于服务商配置默认)
  if (options?.modelSettingsOverride && Object.keys(options.modelSettingsOverride).length > 0) {
    const primary = resolved.chain[0];
    primary.modelSettings = { ...primary.modelSettings, ...options.modelSettingsOverride };
  }

  // function calling：配置声明 tools 能力时启用（Mastra 模型路由对任意服务商生效）
  const toolsEnabled = options?.enableTools !== false
    && resolved.capabilities?.tools === true
    && !(options?.toolFilter && options.toolFilter.length === 0);
  const tools = toolsEnabled ? await getMastraTools(options?.toolFilter ?? undefined) : undefined;

  // 并发信号量（配置了 maxConcurrent 的服务商）
  let release: () => void;
  try {
    release = await acquireProviderSlot(resolved.snapshot.configId, resolved.maxConcurrent);
  } catch (err) {
    yield { type: 'error', error: err instanceof Error ? err.message : '当前模型并发繁忙' };
    return;
  }

  try {
    let isFirst = true;
    for await (const chunk of streamAgentChat({
      chain: resolved.chain,
      messages,
      systemPrompt,
      tools,
      memory: options?.memory,
      context: options?.context,
      signal: options?.signal,
    })) {
      if (chunk.type === 'delta' && isFirst) {
        isFirst = false;
        yield { ...chunk, snapshot: resolved.snapshot };
      } else if (chunk.type === 'done') {
        yield { ...chunk, snapshot: resolved.snapshot };
      } else {
        yield chunk;
      }
    }
  } finally {
    release();
  }
}

const TITLE_MAX_LEN = 30;

/** 去掉 LLM 生成标题中的引号 / 句号 / 思维链残留，并截断长度 */
function sanitizeTitle(raw: string): string {
  return raw
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replaceAll('\n', ' ')
    .replaceAll(/["'“”‘’《》<>#*`]/g, '')
    .replace(/[。.．\s]+$/, '')
    .trim()
    .slice(0, TITLE_MAX_LEN);
}

/**
 * 首轮对话后用 LLM 生成对话标题（使用系统默认配置的非流式调用）。
 * 任一环节失败回退为用户消息前 30 字。返回最终生效的标题。
 */
export async function generateConversationTitle(
  conversationId: number,
  userMessage: string,
  assistantReply: string,
): Promise<string> {
  const fallback = userMessage.slice(0, TITLE_MAX_LEN);
  let title = fallback;
  try {
    const sysCfg = await getRawDefaultProviderConfig();
    if (sysCfg) {
      const { content } = await chatOnce({
        chain: [{ source: sysCfg, model: sysCfg.defaultModel, maxRetries: 0 }],
        messages: [
          {
            role: 'user',
            content: `请用不超过 15 个字概括下面这段对话的主题，直接输出标题本身，不要引号、句号或任何解释。\n\n用户：${userMessage.slice(0, 500)}\n助手：${assistantReply.slice(0, 500)}`,
          },
        ],
        modelSettings: { temperature: 0.3, maxOutputTokens: 60 } satisfies AiModelSettings,
        timeoutMs: 8000,
      });
      const sanitized = sanitizeTitle(content);
      if (sanitized) title = sanitized;
    }
  } catch (err) {
    logger.warn('[ai-chat] auto title generation failed, fallback to prefix', err);
  }
  await updateConversationTitle(conversationId, title);
  return title;
}
