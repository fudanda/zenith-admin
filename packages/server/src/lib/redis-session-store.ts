/**
 * 通用 Redis 会话存储（管理员 / 会员会话共用的底层实现）。
 *
 * 通过 key 前缀参数化隔离不同用户体系（如 `session:` 与 `member-session:`），
 * 上层 session-manager / member-session-manager 各自实例化并保持原有导出 API。
 *
 * 每个登录会话由 jti 标识，对应三类 key 与一个按主体的索引：
 * - `{sessionPrefix}{jti}`      在线会话（滑动 TTL，供在线用户列表 / 活跃时间）
 * - `{refreshPrefix}{jti}`      refresh 授权（TTL = refresh token 有效期）。refresh token 只是承载 jti 的凭据，
 *                               能否续签以该 key 是否存在为准：登出 / 强制下线 / 改密即删除，续签时一次性消费并轮换到新 jti
 * - `{blacklistPrefix}{jti}`    吊销标记（TTL = access token 有效期），值为吊销原因，让尚未过期的 access token 立即失效，
 *                               认证中间件据原因返回精确的 401 文案（被挤下线 / 改密 / 管理员强退）
 * - `{ownerIndexPrefix}{owner}` 该主体（用户 / 会员）全部在线 jti 的 SET：登录期并发限制、我的设备、按用户强退
 *                               都按主体 O(k) 取会话，不再全量 SCAN；成员随会话自然过期而失效，读取时懒清理
 *
 * 因此「登出」与「强制下线」语义一致：吊销 access token + 撤销 refresh 授权 + 删在线会话 + 摘出索引。
 */
import { SESSION_REVOKE_REASONS, type SessionRevokeReason } from '@arcbase/shared/identity';
import redis from './redis';
import { scanKeys } from './redis-scan';

export interface BaseSessionInfo {
  tokenId: string;
  loginAt: Date;
  lastActiveAt: Date;
}

export interface RedisSessionStoreOptions<T extends BaseSessionInfo> {
  /** 完整 session key 前缀（含命名空间），如 `arcbase:session:` */
  sessionPrefix: string;
  /** 完整黑名单 key 前缀（含命名空间），如 `arcbase:blacklist:` */
  blacklistPrefix: string;
  /** 完整 refresh 授权 key 前缀（含命名空间），如 `arcbase:refresh:` */
  refreshPrefix: string;
  /** 按主体索引会话 jti 的 SET key 前缀（含命名空间），如 `arcbase:user-sessions:`；不得与 sessionPrefix 同前缀（getAll 按 sessionPrefix* SCAN） */
  ownerIndexPrefix: string;
  /** 会话所属主体 id（用户 id / 会员 id） */
  ownerIdOf: (session: T) => number;
  /** Session TTL（秒），默认 8h */
  sessionTtlSeconds?: number;
  /** Blacklist TTL（秒），默认 2h（与 accessToken 有效期一致） */
  blacklistTtlSeconds?: number;
  /** refresh 授权 TTL（秒），默认 30d（与 refreshToken 有效期一致）；主体索引 SET 的 TTL 同此值，随每次登录续期 */
  refreshTtlSeconds?: number;
  /** lastActiveAt 回写节流间隔（毫秒）：TTL 每请求都续，活跃时间戳按此粒度更新 */
  activeAtRefreshMs?: number;
}

/** 反序列化并还原 Date 字段 */
function reviveSession<T extends BaseSessionInfo>(raw: string): T {
  const s = JSON.parse(raw) as T;
  s.loginAt = new Date(s.loginAt);
  s.lastActiveAt = new Date(s.lastActiveAt);
  return s;
}

const REVOKE_REASON_SET: ReadonlySet<string> = new Set(SESSION_REVOKE_REASONS);

export function createRedisSessionStore<T extends BaseSessionInfo>(options: RedisSessionStoreOptions<T>) {
  const {
    sessionPrefix,
    blacklistPrefix,
    refreshPrefix,
    ownerIndexPrefix,
    ownerIdOf,
    sessionTtlSeconds = 8 * 60 * 60,
    blacklistTtlSeconds = 2 * 60 * 60,
    refreshTtlSeconds = 30 * 24 * 60 * 60,
    activeAtRefreshMs = 60_000,
  } = options;

  const sessionKey = (tokenId: string) => `${sessionPrefix}${tokenId}`;
  const blacklistKey = (tokenId: string) => `${blacklistPrefix}${tokenId}`;
  const refreshKey = (tokenId: string) => `${refreshPrefix}${tokenId}`;
  const ownerKey = (ownerId: number) => `${ownerIndexPrefix}${ownerId}`;

  /** 登录时注册会话：写会话并挂到主体索引（单次 pipeline） */
  async function register(info: Omit<T, 'lastActiveAt'>): Promise<void> {
    const session = { ...info, lastActiveAt: new Date() } as T;
    const owner = ownerKey(ownerIdOf(session));
    await redis.pipeline()
      .set(sessionKey(info.tokenId), JSON.stringify(session), 'EX', sessionTtlSeconds)
      .sadd(owner, info.tokenId)
      .expire(owner, refreshTtlSeconds)
      .exec();
  }

  /** 为 jti 签发 refresh 授权（登录 / 续签轮换时调用） */
  async function grantRefresh(tokenId: string): Promise<void> {
    await redis.set(refreshKey(tokenId), '1', 'EX', refreshTtlSeconds);
  }

  /** 一次性消费 refresh 授权：存在则删除并返回 true；不存在（已登出 / 已轮换 / 已过期）返回 false */
  async function consumeRefreshGrant(tokenId: string): Promise<boolean> {
    const value = await redis.getdel(refreshKey(tokenId));
    return value !== null;
  }

  /** 刷新会话活跃时间并重置 TTL。返回 false 表示会话不存在。 */
  async function touch(tokenId: string): Promise<boolean> {
    const key = sessionKey(tokenId);
    // GETEX 单次往返完成读取 + TTL 续期（替代 GET+SET 两次往返）
    const raw = await redis.getex(key, 'EX', sessionTtlSeconds);
    if (!raw) return false;
    const session: T = JSON.parse(raw);
    // lastActiveAt 仅按分钟级精度回写，避免每个请求都 JSON.stringify + SET
    const lastActive = new Date(session.lastActiveAt).getTime();
    if (!Number.isFinite(lastActive) || Date.now() - lastActive >= activeAtRefreshMs) {
      session.lastActiveAt = new Date();
      const owner = ownerKey(ownerIdOf(session));
      // XX：仅当 key 仍存在时写入，避免与强制下线的 del 竞争后复活会话；
      // 顺手补挂主体索引：索引缺失（升级前登录、Redis 重建）的活跃会话在一分钟内自愈
      await redis.pipeline()
        .set(key, JSON.stringify(session), 'EX', sessionTtlSeconds, 'XX')
        .sadd(owner, tokenId)
        .expire(owner, refreshTtlSeconds)
        .exec();
    }
    return true;
  }

  /** 检查 token 是否已被吊销（登出 / 强制下线 / 续签轮换后的旧 jti） */
  async function isBlacklisted(tokenId: string): Promise<boolean> {
    const result = await redis.exists(blacklistKey(tokenId));
    return result === 1;
  }

  /** 吊销原因；未吊销返回 null。历史值 `'1'` 与未知值按管理员强制下线处理 */
  async function getRevocation(tokenId: string): Promise<SessionRevokeReason | null> {
    const value = await redis.get(blacklistKey(tokenId));
    if (value === null) return null;
    return REVOKE_REASON_SET.has(value) ? (value as SessionRevokeReason) : 'force-logout';
  }

  /** 把一次吊销的全部写操作追加到 pipeline：拉黑（值 = 原因）、删会话与 refresh 授权、摘出主体索引 */
  function appendRevoke(pipeline: ReturnType<typeof redis.pipeline>, tokenId: string, reason: SessionRevokeReason, ownerId: number | null) {
    pipeline.set(blacklistKey(tokenId), reason, 'EX', blacklistTtlSeconds);
    pipeline.del(sessionKey(tokenId), refreshKey(tokenId));
    if (ownerId !== null) pipeline.srem(ownerKey(ownerId), tokenId);
  }

  /**
   * 吊销一个 jti：拉黑 access token、撤销 refresh 授权、删在线会话、摘出主体索引。
   * 登出、强制下线、续签轮换淘汰旧 jti 都走这里；幂等，key 不存在也安全。
   * 调用方已持有会话时传 ownerId 省一次读取；否则先读会话定位主体（读不到则索引靠懒清理收敛）。
   */
  async function revoke(tokenId: string, reason: SessionRevokeReason = 'force-logout', ownerId?: number | null): Promise<void> {
    let owner = ownerId ?? null;
    if (ownerId === undefined) {
      const raw = await redis.get(sessionKey(tokenId));
      owner = raw ? ownerIdOf(reviveSession<T>(raw)) : null;
    }
    const pipeline = redis.pipeline();
    appendRevoke(pipeline, tokenId, reason, owner);
    await pipeline.exec();
  }

  /** 批量吊销已知会话（单次 pipeline），返回吊销的 tokenId 列表 */
  async function revokeSessions(sessions: T[], reason: SessionRevokeReason): Promise<string[]> {
    if (sessions.length === 0) return [];
    const pipeline = redis.pipeline();
    for (const s of sessions) appendRevoke(pipeline, s.tokenId, reason, ownerIdOf(s));
    await pipeline.exec();
    return sessions.map((s) => s.tokenId);
  }

  /** 强制下线某个会话。会话与 refresh 授权都不存在时返回 false（不做任何写入）。 */
  async function forceLogout(tokenId: string, reason: SessionRevokeReason = 'force-logout'): Promise<boolean> {
    const [raw, grant] = await Promise.all([redis.get(sessionKey(tokenId)), redis.exists(refreshKey(tokenId))]);
    if (!raw && !grant) return false;
    await revoke(tokenId, reason, raw ? ownerIdOf(reviveSession<T>(raw)) : null);
    return true;
  }

  /** 强制下线所有匹配的会话（全量 SCAN + 单次 pipeline，用于跨多个主体的批量场景），返回被下线的 tokenId 列表 */
  async function forceLogoutMatching(predicate: (session: T) => boolean, reason: SessionRevokeReason = 'force-logout'): Promise<string[]> {
    const sessions = await getAll();
    return revokeSessions(sessions.filter((s) => predicate(s)), reason);
  }

  /** 某主体的全部在线会话（按主体索引取，按登录时间倒序）；索引里已过期的成员顺手摘掉 */
  async function listByOwner(ownerId: number): Promise<T[]> {
    const key = ownerKey(ownerId);
    const tokenIds = await redis.smembers(key);
    if (tokenIds.length === 0) return [];
    const values = await redis.mget(...tokenIds.map(sessionKey));
    const alive: T[] = [];
    const stale: string[] = [];
    tokenIds.forEach((tokenId, i) => {
      const raw = values[i];
      if (raw) alive.push(reviveSession<T>(raw));
      else stale.push(tokenId);
    });
    if (stale.length > 0) void redis.srem(key, ...stale).catch(() => { /* 懒清理失败无害，下次再摘 */ });
    return alive.sort((a, b) => b.loginAt.getTime() - a.loginAt.getTime());
  }

  /** 强制下线某主体的全部会话（可保留一个 jti，如改密后保留当前设备），返回被下线的 tokenId 列表 */
  async function forceLogoutByOwner(ownerId: number, options: { except?: string; reason?: SessionRevokeReason } = {}): Promise<string[]> {
    const sessions = await listByOwner(ownerId);
    return revokeSessions(sessions.filter((s) => s.tokenId !== options.except), options.reason ?? 'force-logout');
  }

  /**
   * 把全部在线会话补挂到主体索引（进程启动时执行一次）：索引之前登录的会话、从备份恢复的 Redis 数据
   * 靠这里一次性收敛，不依赖会话再发请求；已在索引中的成员 SADD 幂等。返回处理的会话数。
   */
  async function rebuildOwnerIndex(): Promise<number> {
    const sessions = await getAll();
    if (sessions.length === 0) return 0;
    const pipeline = redis.pipeline();
    for (const s of sessions) {
      const key = ownerKey(ownerIdOf(s));
      pipeline.sadd(key, s.tokenId);
      pipeline.expire(key, refreshTtlSeconds);
    }
    await pipeline.exec();
    return sessions.length;
  }

  /** 正常登出：与强制下线同样吊销 access token 与 refresh 授权（不再只删会话） */
  async function remove(tokenId: string, reason: SessionRevokeReason = 'logout'): Promise<void> {
    await revoke(tokenId, reason);
  }

  /** 获取单个会话 */
  async function get(tokenId: string): Promise<T | null> {
    const raw = await redis.get(sessionKey(tokenId));
    if (!raw) return null;
    return reviveSession<T>(raw);
  }

  /** 获取所有在线会话（按登录时间倒序）*/
  async function getAll(): Promise<T[]> {
    const keys = await scanKeys(`${sessionPrefix}*`);
    if (keys.length === 0) return [];
    const values = await redis.mget(...keys);
    return values
      .filter((v): v is string => v !== null)
      .map((v) => reviveSession<T>(v))
      .sort((a, b) => b.loginAt.getTime() - a.loginAt.getTime());
  }

  /** 在线会话数 */
  async function count(): Promise<number> {
    const keys = await scanKeys(`${sessionPrefix}*`);
    return keys.length;
  }

  return {
    register, grantRefresh, consumeRefreshGrant, touch, isBlacklisted, getRevocation, revoke, revokeSessions,
    forceLogout, forceLogoutMatching, forceLogoutByOwner, listByOwner, rebuildOwnerIndex, remove, get, getAll, count,
  };
}
