import type { OAuthProviderType } from '@arcbase/shared/identity';

export interface OAuthUserInfo {
  openId: string;
  unionId?: string;
  nickname: string;
  avatar?: string;
  email?: string;
  /**
   * 提供方是否断言该邮箱已验证：GitHub 取自 /user/emails 的 verified 标记；
   * 企业提供方（钉钉 / 企微 / 飞书）的邮箱由企业通讯录维护，视为已验证。
   * 未断言的邮箱只能用于展示，不能作为自动关联本地账号的依据。
   */
  emailVerified?: boolean;
}

export interface OAuthTokenResult {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}

export interface OAuthProviderConfig {
  clientId: string;
  clientSecret: string;
  agentId?: string | null;
  corpId?: string | null;
  callbackBaseUrl: string;
}

export interface OAuthProvider {
  readonly provider: OAuthProviderType;
  getAuthUrl(state: string): string;
  getToken(code: string): Promise<OAuthTokenResult>;
  getUserInfo(token: OAuthTokenResult): Promise<OAuthUserInfo>;
}
