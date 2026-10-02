import type { MfaLoginChallenge, SessionConflict } from '@arcbase/shared/identity';

/**
 * 企业 SSO（OIDC / SAML / LDAP）/ 第三方 OAuth 回调拿到 MFA 挑战或会话并发冲突后，跳回登录页复用同一套
 * 验证表单 / 确认弹层时随 `location.state` 交接的数据。
 */
export interface MfaHandoffState {
  mfaChallenge?: MfaLoginChallenge;
  sessionConflict?: SessionConflict;
  redirectTo?: string | null;
}

/** 从 `location.state` 安全读取交接数据（历史栈里的任意对象都可能落到这里，逐字段校验） */
export function readMfaHandoff(state: unknown): MfaHandoffState | null {
  if (!state || typeof state !== 'object') return null;
  const { mfaChallenge, sessionConflict, redirectTo } = state as Partial<MfaHandoffState>;
  const validChallenge = !!mfaChallenge && typeof mfaChallenge === 'object' && mfaChallenge.mfaRequired === true && typeof mfaChallenge.challengeId === 'string';
  const validConflict = !!sessionConflict && typeof sessionConflict === 'object' && sessionConflict.sessionConflict === true && typeof sessionConflict.ticket === 'string';
  if (!validChallenge && !validConflict) return null;
  return {
    mfaChallenge: validChallenge ? mfaChallenge : undefined,
    sessionConflict: validConflict ? sessionConflict : undefined,
    redirectTo: redirectTo ?? null,
  };
}

/** 登录结果里的非终态分支（MFA 挑战 / 会话冲突）转成交接数据；已签发 token 的结果返回 null */
export function handoffFromLoginResult(result: object, redirectTo: string | null | undefined): MfaHandoffState | null {
  if ('mfaRequired' in result && result.mfaRequired === true) return { mfaChallenge: result as MfaLoginChallenge, redirectTo: redirectTo ?? null };
  if ('sessionConflict' in result && result.sessionConflict === true) return { sessionConflict: result as SessionConflict, redirectTo: redirectTo ?? null };
  return null;
}
