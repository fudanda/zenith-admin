/**
 * session-manager 单元测试
 *
 * 覆盖要点：
 *  1. generateTokenId — 格式是 UUID v4
 *  2. registerSession — 写会话（TTL 8h）并挂到用户索引 SET
 *  3. touchSession    — 更新 lastActiveAt；key 不存在时为 no-op
 *  4. isTokenBlacklisted / getTokenRevocation — 命中 / 未命中黑名单，黑名单值即吊销原因
 *  5. forceLogout     — 写黑名单（值 = 原因）+ 删 session 与 refresh 授权 + 摘出索引；两者都不存在时返回 false
 *  6. removeSession   — 登出即吊销：原因 logout
 *  7. grantRefresh / consumeRefreshGrant — refresh 授权签发与一次性消费（轮换基础）
 *  8. listUserSessions / forceLogoutAllByUserExcept — 按用户索引取会话、懒清理过期成员、保留指定 jti
 *
 * 之所以 mock redis 而非真实连接：session-manager 是纯业务逻辑，
 * 其正确性不依赖 Redis 存储细节，只需验证它发送了正确的命令、
 * 使用了正确的 key 前缀和 TTL。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import redis from './redis';
import {
  generateTokenId,
  registerSession,
  touchSession,
  isTokenBlacklisted,
  getTokenRevocation,
  forceLogout,
  forceLogoutAllByUserExcept,
  listUserSessions,
  rebuildUserSessionIndex,
  removeSession,
  grantRefresh,
  consumeRefreshGrant,
} from './session-manager';

// ─── Mock Redis ──────────────────────────────────────────────────────────────
// vi.mock is hoisted by vitest transform, so these mocks are applied before the
// module under test is evaluated, regardless of the textual order here.
vi.mock('./redis', () => ({
  default: {
    get: vi.fn(),
    getex: vi.fn(),
    getdel: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    exists: vi.fn(),
    ttl: vi.fn(),
    scan: vi.fn(),
    mget: vi.fn(),
    incr: vi.fn(),
    expire: vi.fn(),
    sadd: vi.fn(),
    srem: vi.fn(),
    smembers: vi.fn(),
    pipeline: vi.fn(),
  },
}));

// ─── Mock config ─────────────────────────────────────────────────────────────
vi.mock('../config', () => ({
  config: {
    redis: { keyPrefix: 'arcbase:' },
  },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

// vi.mocked 返回带正确 mock 类型的封装，运行时和直接使用 redis 完全一致
const redisMock = vi.mocked(redis);

/** pipeline 以命令名 + 参数记录到 `commands`，exec 时统一返回成功 */
let commands: Array<[string, ...unknown[]]> = [];
function installPipeline() {
  commands = [];
  const chain: Record<string, unknown> = {};
  for (const name of ['set', 'del', 'sadd', 'srem', 'expire'] as const) {
    chain[name] = vi.fn((...args: unknown[]) => { commands.push([name, ...args]); return chain; });
  }
  chain.exec = vi.fn(async () => commands.map(() => [null, 1]));
  redisMock.pipeline.mockReturnValue(chain as unknown as ReturnType<typeof redis.pipeline>);
  return chain;
}
const commandsNamed = (name: string) => commands.filter(([n]) => n === name);

function makeSessionInfo(overrides: Partial<Parameters<typeof registerSession>[0]> = {}) {
  return {
    tokenId: 'test-token-id',
    userId: 1,
    username: 'alice',
    nickname: 'Alice',
    client: 'web' as const,
    ip: '127.0.0.1',
    location: null,
    browser: 'Chrome 120',
    os: 'Windows 10',
    loginAt: new Date(2026, 0, 1, 0, 0, 0),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  installPipeline();
});

describe('generateTokenId', () => {
  it('生成符合 UUID v4 格式的字符串', () => {
    const id = generateTokenId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('每次调用生成不同的值', () => {
    expect(generateTokenId()).not.toBe(generateTokenId());
  });
});

describe('registerSession', () => {
  it('以正确的 key 前缀和 TTL 写入会话，并把 jti 挂到用户索引（索引 TTL 随 refresh 有效期续期）', async () => {
    await registerSession(makeSessionInfo());

    expect(commandsNamed('set')).toEqual([
      ['set', 'arcbase:session:test-token-id', expect.any(String), 'EX', 8 * 60 * 60],
    ]);
    expect(commandsNamed('sadd')).toEqual([['sadd', 'arcbase:user-sessions:1', 'test-token-id']]);
    expect(commandsNamed('expire')).toEqual([['expire', 'arcbase:user-sessions:1', 30 * 24 * 60 * 60]]);
  });

  it('写入的 JSON 包含 lastActiveAt 字段', async () => {
    await registerSession(makeSessionInfo({ tokenId: 'abc' }));
    const [, , json] = commandsNamed('set')[0];
    const written = JSON.parse(json as string);
    expect(written).toHaveProperty('lastActiveAt');
    expect(written.tokenId).toBe('abc');
    expect(written.client).toBe('web');
  });
});

describe('touchSession', () => {
  it('session 存在时通过 GETEX 原子续期 TTL', async () => {
    const session = makeSessionInfo({ tokenId: 'xyz' });
    redisMock.getex.mockResolvedValueOnce(JSON.stringify({ ...session, lastActiveAt: new Date() }));

    const result = await touchSession('xyz');

    expect(result).toBe(true);
    expect(redisMock.getex).toHaveBeenCalledWith('arcbase:session:xyz', 'EX', 8 * 60 * 60);
    // lastActiveAt 新鲜（< 60s）时不回写 JSON，节流生效
    expect(commands).toEqual([]);
  });

  it('lastActiveAt 超过节流间隔时回写新的活跃时间（XX 防复活），并顺手补挂主体索引', async () => {
    const session = makeSessionInfo({ tokenId: 'xyz', userId: 4 });
    const staleActiveAt = new Date(Date.now() - 5 * 60 * 1000); // 5 分钟前
    redisMock.getex.mockResolvedValueOnce(JSON.stringify({ ...session, lastActiveAt: staleActiveAt }));

    await touchSession('xyz');

    expect(commandsNamed('set')).toEqual([['set', 'arcbase:session:xyz', expect.any(String), 'EX', 8 * 60 * 60, 'XX']]);
    const updated = JSON.parse(commandsNamed('set')[0][2] as string);
    expect(new Date(updated.lastActiveAt).getTime()).toBeGreaterThan(staleActiveAt.getTime());
    expect(commandsNamed('sadd')).toEqual([['sadd', 'arcbase:user-sessions:4', 'xyz']]);
  });

  it('session 不存在时为 no-op（不写 Redis）', async () => {
    redisMock.getex.mockResolvedValueOnce(null);

    const result = await touchSession('nonexistent');

    expect(result).toBe(false);
    expect(commands).toEqual([]);
  });
});

describe('isTokenBlacklisted / getTokenRevocation', () => {
  it('Redis 返回 1 时认为已拉黑', async () => {
    redisMock.exists.mockResolvedValueOnce(1);
    expect(await isTokenBlacklisted('bad-token')).toBe(true);
    expect(redisMock.exists).toHaveBeenCalledWith('arcbase:blacklist:bad-token');
  });

  it('Redis 返回 0 时认为未拉黑', async () => {
    redisMock.exists.mockResolvedValueOnce(0);
    expect(await isTokenBlacklisted('good-token')).toBe(false);
  });

  it('黑名单值即吊销原因；历史值 1 与未知值按管理员强制下线；未拉黑为 null', async () => {
    redisMock.get
      .mockResolvedValueOnce('concurrent-login')
      .mockResolvedValueOnce('1')
      .mockResolvedValueOnce('whatever')
      .mockResolvedValueOnce(null);
    expect(await getTokenRevocation('a')).toBe('concurrent-login');
    expect(await getTokenRevocation('b')).toBe('force-logout');
    expect(await getTokenRevocation('c')).toBe('force-logout');
    expect(await getTokenRevocation('d')).toBeNull();
    expect(redisMock.get).toHaveBeenCalledWith('arcbase:blacklist:a');
  });
});

describe('forceLogout', () => {
  it('session 存在时写黑名单（值 = 原因）、删 session 与 refresh 授权、摘出用户索引，并返回 true', async () => {
    const session = makeSessionInfo({ tokenId: 'force-id', userId: 7 });
    redisMock.get.mockResolvedValueOnce(JSON.stringify({ ...session, lastActiveAt: session.loginAt }));
    redisMock.exists.mockResolvedValueOnce(0);

    const result = await forceLogout('force-id');

    expect(result).toBe(true);
    // 黑名单 key 正确，值为原因，TTL = 2h
    expect(commandsNamed('set')).toEqual([['set', 'arcbase:blacklist:force-id', 'force-logout', 'EX', 2 * 60 * 60]]);
    // session 与 refresh 授权 key 一并删除，索引摘出
    expect(commandsNamed('del')).toEqual([['del', 'arcbase:session:force-id', 'arcbase:refresh:force-id']]);
    expect(commandsNamed('srem')).toEqual([['srem', 'arcbase:user-sessions:7', 'force-id']]);
  });

  it('session 不存在但 refresh 授权仍在时同样吊销（无主体可摘，不发 SREM）', async () => {
    redisMock.get.mockResolvedValueOnce(null);
    redisMock.exists.mockResolvedValueOnce(1);

    expect(await forceLogout('rotated-away')).toBe(true);
    expect(commandsNamed('del')).toEqual([['del', 'arcbase:session:rotated-away', 'arcbase:refresh:rotated-away']]);
    expect(commandsNamed('srem')).toEqual([]);
  });

  it('session 与 refresh 授权都不存在时返回 false，不写黑名单', async () => {
    redisMock.get.mockResolvedValueOnce(null);
    redisMock.exists.mockResolvedValueOnce(0);

    const result = await forceLogout('phantom-id');

    expect(result).toBe(false);
    expect(commands).toEqual([]);
  });

  it('可指定吊销原因（被挤下线）', async () => {
    redisMock.get.mockResolvedValueOnce(JSON.stringify({ ...makeSessionInfo({ tokenId: 'k' }), lastActiveAt: new Date() }));
    redisMock.exists.mockResolvedValueOnce(0);
    await forceLogout('k', 'concurrent-login');
    expect(commandsNamed('set')[0][2]).toBe('concurrent-login');
  });
});

describe('removeSession', () => {
  it('登出即吊销：拉黑 access token（原因 logout）并删除 session 与 refresh 授权', async () => {
    redisMock.get.mockResolvedValueOnce(JSON.stringify({ ...makeSessionInfo({ tokenId: 'logout-token', userId: 3 }), lastActiveAt: new Date() }));
    await removeSession('logout-token');
    expect(commandsNamed('set')).toEqual([['set', 'arcbase:blacklist:logout-token', 'logout', 'EX', 2 * 60 * 60]]);
    expect(commandsNamed('del')).toEqual([['del', 'arcbase:session:logout-token', 'arcbase:refresh:logout-token']]);
    expect(commandsNamed('srem')).toEqual([['srem', 'arcbase:user-sessions:3', 'logout-token']]);
  });

  it('续签轮换淘汰旧 jti 时原因为 rotated', async () => {
    redisMock.get.mockResolvedValueOnce(null);
    await removeSession('old', 'rotated');
    expect(commandsNamed('set')[0][2]).toBe('rotated');
  });
});

describe('按用户索引取会话', () => {
  const alive = (tokenId: string, loginAt: Date) => JSON.stringify({ ...makeSessionInfo({ tokenId, userId: 9, loginAt }), lastActiveAt: loginAt });

  it('listUserSessions：SMEMBERS → MGET，按登录时间倒序；索引里已过期的成员顺手 SREM', async () => {
    redisMock.smembers.mockResolvedValueOnce(['t1', 't2', 'gone']);
    redisMock.mget.mockResolvedValueOnce([alive('t1', new Date(2026, 0, 1)), alive('t2', new Date(2026, 0, 2)), null]);
    redisMock.srem.mockResolvedValueOnce(1);

    const sessions = await listUserSessions(9);

    expect(redisMock.smembers).toHaveBeenCalledWith('arcbase:user-sessions:9');
    expect(redisMock.mget).toHaveBeenCalledWith('arcbase:session:t1', 'arcbase:session:t2', 'arcbase:session:gone');
    expect(sessions.map((s) => s.tokenId)).toEqual(['t2', 't1']);
    expect(sessions[0].loginAt).toBeInstanceOf(Date);
    expect(redisMock.srem).toHaveBeenCalledWith('arcbase:user-sessions:9', 'gone');
  });

  it('索引为空时不 MGET', async () => {
    redisMock.smembers.mockResolvedValueOnce([]);
    expect(await listUserSessions(9)).toEqual([]);
    expect(redisMock.mget).not.toHaveBeenCalled();
  });

  it('forceLogoutAllByUserExcept：保留指定 jti，其余单次 pipeline 吊销（默认原因 password-changed）', async () => {
    redisMock.smembers.mockResolvedValueOnce(['keep', 'a', 'b']);
    redisMock.mget.mockResolvedValueOnce([alive('keep', new Date()), alive('a', new Date()), alive('b', new Date())]);

    const kicked = await forceLogoutAllByUserExcept(9, 'keep');

    expect(kicked.sort()).toEqual(['a', 'b']);
    expect(commandsNamed('set').map((c) => c[1]).sort()).toEqual(['arcbase:blacklist:a', 'arcbase:blacklist:b']);
    expect(commandsNamed('set').every((c) => c[2] === 'password-changed')).toBe(true);
    expect(commandsNamed('srem').map((c) => c[2]).sort()).toEqual(['a', 'b']);
    expect(redisMock.pipeline).toHaveBeenCalledTimes(1);
  });

  it('rebuildUserSessionIndex：SCAN 全部在线会话，按 userId 补挂到各自索引并续期', async () => {
    redisMock.scan.mockResolvedValueOnce(['0', ['arcbase:session:x', 'arcbase:session:y']]);
    redisMock.mget.mockResolvedValueOnce([
      JSON.stringify({ ...makeSessionInfo({ tokenId: 'x', userId: 1 }), lastActiveAt: new Date() }),
      JSON.stringify({ ...makeSessionInfo({ tokenId: 'y', userId: 2 }), lastActiveAt: new Date() }),
    ]);

    expect(await rebuildUserSessionIndex()).toBe(2);
    expect(commandsNamed('sadd').sort()).toEqual([['sadd', 'arcbase:user-sessions:1', 'x'], ['sadd', 'arcbase:user-sessions:2', 'y']]);
    expect(commandsNamed('expire')).toHaveLength(2);
  });
});

describe('refresh 授权', () => {
  it('grantRefresh 以 30d TTL 写入 refresh key', async () => {
    await grantRefresh('jti-1');
    expect(redisMock.set).toHaveBeenCalledWith('arcbase:refresh:jti-1', '1', 'EX', 30 * 24 * 60 * 60);
  });

  it('consumeRefreshGrant 通过 GETDEL 一次性消费：存在返回 true，之后再消费返回 false', async () => {
    redisMock.getdel.mockResolvedValueOnce('1').mockResolvedValueOnce(null);
    expect(await consumeRefreshGrant('jti-1')).toBe(true);
    expect(await consumeRefreshGrant('jti-1')).toBe(false);
    expect(redisMock.getdel).toHaveBeenCalledWith('arcbase:refresh:jti-1');
  });
});
