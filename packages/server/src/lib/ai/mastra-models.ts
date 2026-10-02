import { AI_CUSTOM_PROVIDER_ID } from '@arcbase/shared/ai';
import type { AiModelSettings, AiModelFallbackRef } from '@arcbase/shared/ai';
import type { OpenAICompatibleConfig } from '@mastra/core/llm';
import type { ModelWithRetries } from '@mastra/core/agent';

/**
 * Mastra 模型解析层:DB 服务商配置 → Mastra 模型契约。
 *
 * - providerId 为 Mastra 模型目录 ID('openai' / 'anthropic' / 'deepseek' / ...)时,
 *   模型 ID 为 `<providerId>/<model>`,官方端点由 Mastra 目录解析,DB 的 apiKey 显式注入
 *   (优先级高于环境变量);baseUrl 填写时覆盖官方端点。
 * - providerId 为 'custom' 时按 OpenAI 兼容协议直连 baseUrl(私有网关 / 本地模型)。
 *
 * ⚠️ @mastra/core 首次加载 ~8s,属重型依赖:本文件只做纯类型与纯函数,
 * 运行时模块经 loadMastraAgentModule() 等惰性加载,禁止顶层静态 import 值。
 */

/** 构造 Mastra 模型所需的最小配置切面(系统服务商配置与用户自定义配置均可满足) */
export interface AiModelSource {
  providerId: string;
  baseUrl: string | null;
  apiKey: string;
  headers?: Record<string, string> | null;
  modelSettings?: AiModelSettings | null;
  providerOptions?: Record<string, Record<string, unknown>> | null;
}

/** DB 配置 + 模型名 → Mastra 模型配置(OpenAICompatibleConfig 承载显式 apiKey / url / headers) */
export function toMastraModel(source: AiModelSource, model: string): OpenAICompatibleConfig {
  const providerId = source.providerId || AI_CUSTOM_PROVIDER_ID;
  return {
    id: `${providerId}/${model}` as `${string}/${string}`,
    apiKey: source.apiKey,
    ...(source.baseUrl ? { url: source.baseUrl } : {}),
    ...(source.headers && Object.keys(source.headers).length > 0 ? { headers: source.headers } : {}),
  };
}

export interface ModelChainEntry {
  source: AiModelSource;
  model: string;
  maxRetries?: number;
  /** 该级生效的模型设置(已合并覆盖项) */
  modelSettings?: AiModelSettings | null;
}

/**
 * 推理档位兼容层:Mastra 统一档位(modelSettings.reasoning)只对 V4 目录模型生效,
 * OpenAI 兼容直连(V2 模型类)会忽略。此处把档位翻译为该模型类的 providerOptions:
 * - reasoningEffort → 请求体 reasoning_effort(标准字段);
 * - thinking.type → 请求体 thinking(schema 外未知键原样透传,兼容 DeepSeek 系 /
 *   私有网关按 thinking 开关决定是否回传 reasoning_content 的行为)。
 * 已有同名 providerOptions 键(用户显式配置)优先,不覆盖。
 */
function withReasoningProviderOptions(
  source: AiModelSource,
  modelSettings: AiModelSettings | null | undefined,
): Record<string, Record<string, unknown>> | null {
  const base = source.providerOptions ?? null;
  const reasoning = modelSettings?.reasoning;
  if (!reasoning || reasoning === 'provider-default') return base;
  const key = (source.providerId || AI_CUSTOM_PROVIDER_ID).split('.')[0];
  const injected: Record<string, unknown> = {
    reasoningEffort: reasoning,
    thinking: { type: reasoning === 'none' ? 'disabled' : 'enabled' },
  };
  return { ...base, [key]: { ...injected, ...base?.[key] } };
}

/** 把主模型 + 降级级联解析为 Mastra ModelWithRetries 数组(数组即降级链,5xx/限流/超时自动切换) */
export function buildModelChain(entries: ModelChainEntry[]): ModelWithRetries[] {
  return entries.map((e) => {
    const providerOptions = withReasoningProviderOptions(e.source, e.modelSettings);
    return {
      model: toMastraModel(e.source, e.model),
      maxRetries: e.maxRetries ?? 1,
      ...(e.modelSettings && Object.keys(e.modelSettings).length > 0 ? { modelSettings: e.modelSettings } : {}),
      ...(providerOptions && Object.keys(providerOptions).length > 0
        ? { providerOptions: providerOptions as never }
        : {}),
    };
  });
}

export type { AiModelSettings, AiModelFallbackRef };

// ─── 惰性模块加载(重型依赖约束) ─────────────────────────────────────────────

let agentModule: Promise<typeof import('@mastra/core/agent')> | null = null;

/** 惰性加载 @mastra/core/agent(首次 ~8s、热缓存 ~0.7s,进程内共享) */
export function loadMastraAgentModule(): Promise<typeof import('@mastra/core/agent')> {
  agentModule ??= import('@mastra/core/agent');
  return agentModule;
}

let toolsModule: Promise<typeof import('@mastra/core/tools')> | null = null;

/** 惰性加载 @mastra/core/tools */
export function loadMastraToolsModule(): Promise<typeof import('@mastra/core/tools')> {
  toolsModule ??= import('@mastra/core/tools');
  return toolsModule;
}

let llmModule: Promise<typeof import('@mastra/core/llm')> | null = null;

/** 惰性加载 @mastra/core/llm(PROVIDER_REGISTRY 目录 / 能力查询) */
export function loadMastraLlmModule(): Promise<typeof import('@mastra/core/llm')> {
  llmModule ??= import('@mastra/core/llm');
  return llmModule;
}
