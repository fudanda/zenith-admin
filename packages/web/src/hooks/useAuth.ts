import { createContext, useContext } from 'react';
import type { ApiResponse } from '@zenith/shared/core';
import type { ImpersonationStartResult, User, LoginResponse, LoginResult, GoSession } from '@zenith/shared/identity';
import type { StoredAccount } from '@/lib/account-store';
import type { ImpersonationMarker } from '@/lib/impersonation-store';

export type AuthStatus = 'checking' | 'authenticated' | 'anonymous' | 'unavailable';
export type AuthResponse<T> = ApiResponse<T> & { retryAfterSeconds?: number };
export type AdminLoginResult = LoginResult | GoSession;

export interface LoginOptions {
  /** 添加账号模式：保留当前登录，成功后停靠原账号并整页切换为新账号 */
  addAccount?: boolean;
}

export interface SwitchAccountResult {
  ok: boolean;
  /** 目标账号会话已失效（已从停靠区移除），应引导重新登录 */
  expired?: boolean;
  username?: string;
  message?: string;
}

export interface AuthContextValue {
  user: Omit<User, 'password'> | null;
  permissions: string[];
  status: AuthStatus;
  loading: boolean;
  /** 会话正在（重新）校验：unavailable 页据此显示重试进度而不整页切回加载态 */
  refreshing: boolean;
  error: Error | null;
  /** 停靠中的其他已登录账号（按最近使用倒序） */
  parkedAccounts: StoredAccount[];
  /** 是否还能再添加账号（活跃 + 停靠总数受 MAX_STORED_ACCOUNTS 限制） */
  canAddAccount: boolean;
  login: (
    username: string,
    password: string,
    captchaId?: string,
    captchaCode?: string,
    tenantCode?: string,
    options?: LoginOptions,
  ) => Promise<AuthResponse<AdminLoginResult>>;
  verifyMfaLogin: (
    challengeId: string,
    code: string,
    rememberDevice: boolean,
    options?: LoginOptions,
  ) => Promise<AuthResponse<LoginResponse>>;
  /** 会话并发拒绝模式：用户确认「下线其它设备并登录」，凭冲突票据继续原登录流程（可能再转入 MFA） */
  resolveSessionConflict: (ticket: string, options?: LoginOptions) => Promise<AuthResponse<AdminLoginResult>>;
  register: (data: {
    username: string;
    nickname: string;
    email: string;
    password: string;
  }, options?: LoginOptions) => Promise<AuthResponse<LoginResponse>>;
  logout: () => void;
  refresh: () => Promise<void>;
  updateUser: (user: Omit<User, 'password'>) => void;
  /** 切换到指定停靠账号：refresh 换发新令牌并整页重载 */
  switchAccount: (userId: number) => Promise<SwitchAccountResult>;
  /** 注销并移除一个停靠账号（不影响当前登录） */
  removeAccount: (userId: number) => Promise<void>;
  /** 退出全部账号（当前 + 全部停靠）并回到登录页 */
  logoutAllAccounts: () => Promise<void>;
  /** 当前浏览器处于模拟登录态时的标记（操作者 / 目标 / 模式 / 到期）；本人登录为 null */
  impersonation: ImpersonationMarker | null;
  /** 以目标用户身份进入系统：停靠当前（操作者）账号 → 写入目标 access token → 整页重载 */
  startImpersonation: (result: ImpersonationStartResult) => void;
  /** 结束模拟：通知服务端关闭会话（可跳过，如令牌已失效）→ 用停靠的操作者凭证换发会话 → 整页重载 */
  endImpersonation: (options?: { skipServer?: boolean }) => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
