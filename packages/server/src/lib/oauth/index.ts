import { eq, inArray } from 'drizzle-orm';
import { OAUTH_PROVIDERS, type OAuthProviderType } from '@arcbase/shared/identity';
import type { OAuthProvider, OAuthProviderConfig } from './types';
import { GitHubProvider } from './github';
import { DingTalkProvider } from './dingtalk';
import { WeChatWorkProvider } from './wechat-work';
import { FeishuProvider } from './feishu';
import { db } from '../../db';
import { oauthConfigs } from '../../db/schema';
import { config } from '../../config';

export type { OAuthProvider, OAuthProviderConfig, OAuthUserInfo, OAuthTokenResult } from './types';

/** 从数据库加载 OAuth 配置，构建 Provider 实例 */
async function loadProviderConfig(type: OAuthProviderType): Promise<OAuthProviderConfig | null> {
  const [row] = await db.select().from(oauthConfigs).where(eq(oauthConfigs.provider, type)).limit(1);
  if (!row?.clientId || !row.clientSecret) return null;
  return {
    clientId: row.clientId,
    clientSecret: row.clientSecret,
    agentId: row.agentId,
    corpId: row.corpId,
    callbackBaseUrl: config.oauth.callbackBaseUrl,
  };
}

function createProvider(type: OAuthProviderType, cfg: OAuthProviderConfig): OAuthProvider {
  switch (type) {
    case 'github': return new GitHubProvider(cfg);
    case 'dingtalk': return new DingTalkProvider(cfg);
    case 'wechat_work': return new WeChatWorkProvider(cfg);
    case 'feishu': return new FeishuProvider(cfg);
    default: throw new Error(`Unsupported OAuth provider: ${type}`);
  }
}

/** 获取 OAuth provider（从 DB 读取配置） */
export async function getOAuthProvider(type: OAuthProviderType): Promise<OAuthProvider> {
  const cfg = await loadProviderConfig(type);
  if (!cfg) throw new Error(`OAuth provider "${type}" 尚未配置或配置不完整`);
  return createProvider(type, cfg);
}

/** 配置行是否可用于发起登录：已启用且凭据完整（企业微信另需 corpId） */
function isOauthConfigUsable(row: typeof oauthConfigs.$inferSelect): boolean {
  if (!row.enabled || !row.clientId || !row.clientSecret) return false;
  if (row.provider === 'wechat_work' && !row.corpId) return false;
  return true;
}

/** 检查 OAuth 提供方是否已在 DB 中配置好必要的凭据且已启用 */
export async function isProviderConfigured(type: OAuthProviderType): Promise<boolean> {
  const [row] = await db.select().from(oauthConfigs).where(eq(oauthConfigs.provider, type)).limit(1);
  return !!row && isOauthConfigUsable(row);
}

/** 当前可发起登录的提供方，按 OAUTH_PROVIDERS 固定顺序返回（登录页 / 账号绑定按此渲染入口） */
export async function listConfiguredProviders(): Promise<OAuthProviderType[]> {
  const rows = await db.select().from(oauthConfigs).where(inArray(oauthConfigs.provider, [...OAUTH_PROVIDERS]));
  const usable = new Set(rows.filter(isOauthConfigUsable).map((row) => row.provider));
  return OAUTH_PROVIDERS.filter((provider) => usable.has(provider));
}
