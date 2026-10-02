import { describe, expect, it, vi } from 'vitest';
import { Client } from '@arcbase/client';
import { createCookieSession } from './session';

const data = { user: { id: 1, username: 'admin', nickname: '管理员', status: 'enabled', email: null, roles: [], passwordUpdatedAt: '2026-09-30T00:00:00Z', createdAt: '2026-09-30T00:00:00Z', updatedAt: '2026-09-30T00:00:00Z' }, permissions: ['*'], csrfToken: 'test-csrf', superAdmin: true };
const reply = (status: number, value: unknown = null) => new Response(JSON.stringify({ code: status === 200 ? 0 : status, message: 'response', data: value }), { status });

describe('Cookie session lifecycle', () => {
  it('restores /me, shares CSRF, invalidates on protected 401 and logs out through Go', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(reply(200, data));
    const client = new Client({ transport: send });
    const session = createCookieSession(client);
    await session.refresh();
    expect(session.getSnapshot().status).toBe('authenticated');
    expect(client.sessionHeaders()['X-CSRF-Token']).toBe('test-csrf');
    send.mockResolvedValueOnce(reply(401));
    await client.get('/api/v1/positions');
    expect(session.getSnapshot().status).toBe('anonymous');
    send.mockResolvedValueOnce(reply(200, data));
    await session.login({ username: 'admin', password: 'explicit-password' });
    send.mockResolvedValueOnce(reply(200));
    await session.logout();
    expect(new Headers(send.mock.calls.at(-1)?.[1]?.headers).get('X-CSRF-Token')).toBe('test-csrf');
    expect(session.getSnapshot().session).toBeNull(); session.dispose();
  });
  it('fails closed on database/unavailable responses', async () => {
    const session = createCookieSession(new Client({ transport: async () => reply(503) }));
    await session.refresh();
    expect(session.getSnapshot()).toMatchObject({ status: 'unavailable', session: null, refreshing: false }); session.dispose();
  });
  it('ignores a stale /me result after another login and cancels requests on disposal', async () => {
    let finish: (value: Response) => void = () => {};
    let signal: AbortSignal | null | undefined;
    const send = vi.fn<typeof fetch>().mockImplementationOnce((_url, init) => { signal = init?.signal; return new Promise(resolve => { finish = resolve; }); }).mockResolvedValue(reply(200, data));
    const client = new Client({ transport: send }); const session = createCookieSession(client);
    const refresh = session.refresh();
    await session.login({ username: 'admin', password: 'password' });
    finish(reply(200, { ...data, user: { ...data.user, id: 2, username: 'stale-user' } })); await refresh;
    expect(session.getSnapshot().session?.user.username).toBe('admin');
    send.mockImplementationOnce((_url, init) => { signal = init?.signal; return new Promise(resolve => { finish = resolve; }); });
    const pending = session.refresh(); session.dispose();
    expect(signal?.aborted).toBe(true); finish(reply(200, data)); await pending;
    expect(client.sessionHeaders()['X-CSRF-Token']).toBe('test-csrf');
  });
});
