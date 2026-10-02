import { IMPERSONATION_STORE_KEY } from '@arcbase/shared/core';

/**
 * 模拟登录的本地标记（localStorage，本模块是唯一读写方）。
 *
 * 设计约定：
 * - 模拟态下 TOKEN_KEY 槽位是目标身份的短时 access token，REFRESH_TOKEN_KEY 为空（服务端不签发、不可续签）；
 *   因此账号切换器的 `snapshotCurrentAccount()` 天然返回 null，模拟身份永远不会被停靠；
 * - 操作者自己的凭证以停靠账号形态保存在账号切换器里，本标记只记「回切到谁」与展示信息；
 * - 结束 / 到期 / 被强制结束时清除标记并用停靠的 refreshToken 换发操作者会话。
 */
export interface ImpersonationMarker {
  impersonationId: number;
  operatorUserId: number;
  operatorUsername: string;
  targetUserId: number;
  targetUsername: string;
  targetNickname: string;
  readOnly: boolean;
  /** YYYY-MM-DD HH:mm:ss */
  expiresAt: string;
}

function isMarker(value: unknown): value is ImpersonationMarker {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.impersonationId === 'number'
    && typeof v.operatorUserId === 'number'
    && typeof v.operatorUsername === 'string'
    && typeof v.targetUserId === 'number'
    && typeof v.targetUsername === 'string'
    && typeof v.targetNickname === 'string'
    && typeof v.readOnly === 'boolean'
    && typeof v.expiresAt === 'string';
}

export function readImpersonationMarker(): ImpersonationMarker | null {
  try {
    const raw = localStorage.getItem(IMPERSONATION_STORE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isMarker(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeImpersonationMarker(marker: ImpersonationMarker): void {
  localStorage.setItem(IMPERSONATION_STORE_KEY, JSON.stringify(marker));
}

export function clearImpersonationMarker(): void {
  localStorage.removeItem(IMPERSONATION_STORE_KEY);
}
