/**
 * WebSocket 升级请求的管理端鉴权，与 HTTP authMiddleware 同一口径：
 * - access token 从 `Sec-WebSocket-Protocol: arcbase-auth, <token>` 读取（不接受 URL 查询串，避免落日志）
 * - 拒绝会员 / refresh token，要求 roles 数组
 * - 实时校验用户与租户状态（checkAdminJwtSubject）
 * - 黑名单校验；Redis 异常时与 HTTP 一致 fail-open（access token 最长 2h）
 */
import type { Context } from 'hono';
import { WS_AUTH_SUBPROTOCOL } from '@arcbase/shared/platform';
import { verifyToken } from './jwt';
import { checkAdminJwtSubject, type JwtPayload } from '../middleware/auth';
import { getSession, isTokenBlacklisted } from './session-manager';
import logger from './logger';

export interface WsIdentity {
  payload: JwtPayload;
  /** 在线会话中记录的昵称（用于 typing / 通话等需要展示名的转发，服务端权威） */
  nickname: string;
}

/** 从子协议头提取 bearer token：`arcbase-auth, <token>` */
export function extractWsBearerToken(c: Context): string | null {
  const header = c.req.header('sec-websocket-protocol');
  if (!header) return null;
  const entries = header.split(',').map((s) => s.trim()).filter(Boolean);
  if (!entries.includes(WS_AUTH_SUBPROTOCOL)) return null;
  const token = entries.find((s) => s !== WS_AUTH_SUBPROTOCOL);
  return token && token.split('.').length === 3 ? token : null;
}

export async function authenticateAdminWs(c: Context): Promise<WsIdentity | null> {
  const token = extractWsBearerToken(c);
  if (!token) return null;
  let payload: JwtPayload & { type?: string };
  try {
    payload = await verifyToken<JwtPayload & { type?: string }>(token);
  } catch {
    return null;
  }
  if (payload.type === 'member' || payload.type === 'refresh' || !Array.isArray(payload.roles) || !payload.jti) {
    return null;
  }
  const subject = await checkAdminJwtSubject(payload);
  if (!subject.ok) return null;
  try {
    if (await isTokenBlacklisted(payload.jti)) return null;
  } catch (err) {
    logger.warn('[ws-auth] Redis blacklist check failed, allowing connection:', err);
  }
  let nickname = subject.payload.username;
  try {
    const session = await getSession(payload.jti);
    if (session?.nickname) nickname = session.nickname;
  } catch { /* 昵称仅用于展示，失败回落用户名 */ }
  return { payload: subject.payload, nickname };
}
