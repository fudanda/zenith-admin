/**
 * 会话并发限制（身份安全 → 会话并发）。
 *
 * 锁定：上限 0 不动作；kick-oldest 按登录时间挤掉最早的、保留新登录自身；按终端分别计算时只看同类终端；
 * 模拟会话不计数不被挤；拒绝模式未经确认不挤人、`evictAll` 全挤；被挤方收到带新登录信息的 WS 消息后连接被关闭；
 * `findConflictingSessions` 只在拒绝模式且名额已满时返回占用者。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionConcurrencyPolicy } from '@arcbase/shared/settings';
import type { SessionInfo } from '../../lib/session-manager';

const mocks = vi.hoisted(() => ({
  listUserSessions: vi.fn(),
  revokeSessions: vi.fn(),
  sendToToken: vi.fn(),
  closeTokenConnection: vi.fn(),
  getSettings: vi.fn(),
  redis: { set: vi.fn(), getdel: vi.fn() },
}));

vi.mock('../../lib/session-manager', () => ({ listUserSessions: mocks.listUserSessions, revokeSessions: mocks.revokeSessions }));
vi.mock('../../lib/ws-manager', () => ({ sendToToken: mocks.sendToToken, closeTokenConnection: mocks.closeTokenConnection }));
vi.mock('../../lib/settings', () => ({ getSettings: mocks.getSettings }));
vi.mock('../../lib/redis', () => ({ default: mocks.redis }));

import {
  consumeSessionConflictTicket,
  enforceSessionLimit,
  findConflictingSessions,
  issueSessionConflict,
  type NewLoginContext,
} from './session-policy.service';

const T0 = new Date('2026-09-15T00:00:00Z');
const at = (min: number) => new Date(T0.getTime() + min * 60_000);

function session(tokenId: string, loginMin: number, overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    tokenId, userId: 1, username: 'alice', nickname: 'Alice', tenantId: null, client: 'web',
    ip: '10.0.0.1', location: null, browser: 'Chrome 120', os: 'Windows 10',
    loginAt: at(loginMin), lastActiveAt: at(loginMin), ...overrides,
  };
}

const newLogin: NewLoginContext = {
  userId: 1, tenantId: null, tokenId: 'new', client: 'web',
  ip: '10.0.0.9', location: '广东深圳', browser: 'Edge 130', os: 'macOS 15', loginAt: at(100),
};

const policy = (overrides: Partial<SessionConcurrencyPolicy> = {}): SessionConcurrencyPolicy => ({
  maxSessions: 1, scope: 'global', exceedAction: 'kick-oldest', ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  mocks.revokeSessions.mockImplementation(async (sessions: SessionInfo[]) => sessions.map((s) => s.tokenId));
});

describe('enforceSessionLimit', () => {
  it('上限 0：不读会话、不动作', async () => {
    expect(await enforceSessionLimit(newLogin, { policy: policy({ maxSessions: 0 }) })).toEqual([]);
    expect(mocks.listUserSessions).not.toHaveBeenCalled();
  });

  it('单处登录：挤掉全部既有本人会话，保留新登录自身，并按 concurrent-login 吊销', async () => {
    mocks.listUserSessions.mockResolvedValue([session('new', 100), session('old-1', 10), session('old-2', 20)]);

    const kicked = await enforceSessionLimit(newLogin, { policy: policy() });

    expect(kicked.map((s) => s.tokenId)).toEqual(['old-1', 'old-2']);
    expect(mocks.revokeSessions).toHaveBeenCalledWith(kicked, 'concurrent-login');
  });

  it('上限 N：只挤掉最早的 (既有 + 1 - N) 个', async () => {
    mocks.listUserSessions.mockResolvedValue([session('new', 100), session('c', 30), session('a', 10), session('b', 20)]);

    const kicked = await enforceSessionLimit(newLogin, { policy: policy({ maxSessions: 3 }) });

    expect(kicked.map((s) => s.tokenId)).toEqual(['a']);
  });

  it('按终端分别计算：只有同类终端参与统计', async () => {
    mocks.listUserSessions.mockResolvedValue([
      session('new', 100), session('phone', 10, { client: 'mobile' }), session('web-old', 20),
    ]);

    const kicked = await enforceSessionLimit(newLogin, { policy: policy({ scope: 'per-client' }) });

    expect(kicked.map((s) => s.tokenId)).toEqual(['web-old']);
  });

  it('模拟会话是操作者的会话：不计数、不被挤', async () => {
    mocks.listUserSessions.mockResolvedValue([session('new', 100), session('imp', 10, { impersonatorId: 99, impersonatorName: 'admin' })]);

    expect(await enforceSessionLimit(newLogin, { policy: policy() })).toEqual([]);
    expect(mocks.revokeSessions).not.toHaveBeenCalled();
  });

  it('拒绝模式：未经确认不挤人；evictAll 时全部挤掉（含超出上限之外的）', async () => {
    mocks.listUserSessions.mockResolvedValue([session('new', 100), session('a', 10), session('b', 20)]);

    expect(await enforceSessionLimit(newLogin, { policy: policy({ exceedAction: 'reject-new' }) })).toEqual([]);
    const kicked = await enforceSessionLimit(newLogin, { policy: policy({ exceedAction: 'reject-new', maxSessions: 5 }), evictAll: true });
    expect(kicked.map((s) => s.tokenId)).toEqual(['a', 'b']);
  });

  it('被挤方：先收到带新登录信息的 force-logout 消息，500ms 后连接被关闭', async () => {
    mocks.listUserSessions.mockResolvedValue([session('new', 100), session('old', 10)]);

    await enforceSessionLimit(newLogin, { policy: policy() });

    expect(mocks.sendToToken).toHaveBeenCalledWith('old', {
      type: 'session:force-logout',
      payload: expect.objectContaining({
        code: 'concurrent-login',
        reason: expect.stringContaining('广东深圳 · 网页 Edge 130 / macOS 15 登录'),
        by: expect.objectContaining({ client: 'web', ip: '10.0.0.9', location: '广东深圳', browser: 'Edge 130', os: 'macOS 15' }),
      }),
    });
    expect(mocks.closeTokenConnection).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(mocks.closeTokenConnection).toHaveBeenCalledWith('old', '被挤下线');
  });

  it('未传策略时按用户所属租户读取 identitySecurity.session', async () => {
    mocks.getSettings.mockResolvedValue({ session: policy({ maxSessions: 0 }) });
    await enforceSessionLimit({ ...newLogin, tenantId: 5 });
    expect(mocks.getSettings).toHaveBeenCalledWith('identitySecurity', { tenantId: 5 });
  });
});

describe('findConflictingSessions', () => {
  it('非拒绝模式或未启用限制：不读会话、返回空', async () => {
    expect(await findConflictingSessions({ userId: 1, tenantId: null, client: 'web' }, policy())).toEqual([]);
    expect(await findConflictingSessions({ userId: 1, tenantId: null, client: 'web' }, policy({ maxSessions: 0, exceedAction: 'reject-new' }))).toEqual([]);
    expect(mocks.listUserSessions).not.toHaveBeenCalled();
  });

  it('拒绝模式名额已满：返回占用名额的既有会话（排除模拟会话）；未满返回空', async () => {
    mocks.listUserSessions.mockResolvedValue([session('a', 10), session('imp', 5, { impersonatorId: 9 })]);
    const login = { userId: 1, tenantId: null, client: 'web' as const };

    expect((await findConflictingSessions(login, policy({ exceedAction: 'reject-new' }))).map((s) => s.tokenId)).toEqual(['a']);
    expect(await findConflictingSessions(login, policy({ exceedAction: 'reject-new', maxSessions: 2 }))).toEqual([]);
  });
});

describe('冲突票据', () => {
  const context = {
    userId: 1, username: 'alice', tenantId: null, ip: '10.0.0.9', ua: 'UA', client: 'web' as const,
    deviceId: 'd1', rememberDevice: true, logMessage: '登录成功',
  };

  it('issueSessionConflict：5 分钟一次性票据落 Redis，返回冲突结果（不含 tokenId，按活跃时间倒序）', async () => {
    const result = await issueSessionConflict(context, [session('old', 10), session('new', 20)], 1);

    expect(result.sessionConflict).toBe(true);
    expect(result.maxSessions).toBe(1);
    expect(result.sessions.map((s) => s.loginAt)).toEqual(['2026-09-15 08:20:00', '2026-09-15 08:10:00']);
    expect(result.sessions[0]).not.toHaveProperty('tokenId');
    expect(mocks.redis.set).toHaveBeenCalledWith(`session-conflict:${result.ticket}`, expect.any(String), 'EX', 300);
    const stored = JSON.parse(mocks.redis.set.mock.calls[0][1] as string);
    expect(stored).toMatchObject({ userId: 1, client: 'web', deviceId: 'd1', rememberDevice: true, logMessage: '登录成功' });
    expect(stored.expiresAt).toBe(result.expiresAt);
  });

  it('consumeSessionConflictTicket：GETDEL 一次性消费；缺失或过期 → 400', async () => {
    mocks.redis.getdel
      .mockResolvedValueOnce(JSON.stringify({ ...context, expiresAt: Date.now() + 60_000 }))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(JSON.stringify({ ...context, expiresAt: Date.now() - 1 }));

    await expect(consumeSessionConflictTicket('t')).resolves.toMatchObject({ userId: 1, logMessage: '登录成功' });
    expect(mocks.redis.getdel).toHaveBeenCalledWith('session-conflict:t');
    await expect(consumeSessionConflictTicket('gone')).rejects.toMatchObject({ status: 400 });
    await expect(consumeSessionConflictTicket('stale')).rejects.toMatchObject({ status: 400 });
  });
});
