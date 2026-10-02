import type { OAuthPendingState } from '@arcbase/shared/identity';

const STORAGE_KEY = 'arcbase_oauth_pending';

/**
 * 第三方登录 / 绑定的往返上下文：跳转到提供方前写入 sessionStorage，回调页读出并与 URL 里的 `state` 比对。
 * 这是登录 CSRF 防护的浏览器侧一半——攻击者可以拿到我们签发的合法 state，
 * 但拿不到受害者浏览器里暂存的那一份；服务端再做单次消费与 provider / 意图 / 用户比对。
 */
export function rememberOAuthPending(pending: OAuthPendingState): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(pending));
  } catch {
    // sessionStorage 不可用（隐私模式等）：回调页会因缺少暂存状态而拒绝，提示重新发起
  }
}

/** 取出并清除暂存状态（单次消费；任何字段缺失或类型不对都视为无效） */
export function takeOAuthPending(): OAuthPendingState | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OAuthPendingState>;
    if (typeof parsed.state !== 'string' || typeof parsed.provider !== 'string') return null;
    if (parsed.intent !== 'login' && parsed.intent !== 'bind') return null;
    return {
      state: parsed.state,
      provider: parsed.provider,
      intent: parsed.intent,
      redirectTo: typeof parsed.redirectTo === 'string' ? parsed.redirectTo : null,
    };
  } catch {
    return null;
  }
}
