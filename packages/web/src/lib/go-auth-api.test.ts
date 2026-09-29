import { describe, expect, it, vi } from 'vitest';
import { goAuthContract } from '@zenith/shared/identity';
import { apiRaw } from '@/lib/contract-query';
import { createGoApiClient } from './go-auth-api';
import { GoTransport } from './go-transport';

const session = {
  user: { id: 1, username: 'admin', nickname: '管理员', tenantId: null, status: 'enabled', email: null },
  permissions: ['*'],
  csrfToken: 'csrf-from-go',
  tenantViewId: null,
  superAdmin: true,
};

function reply(status: number, data: unknown) {
  return new Response(JSON.stringify({ code: status === 200 ? 0 : status, message: status === 200 ? 'success' : 'error', data }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('Go auth contract adapter', () => {
  it('uses Go routes and carries the restored CSRF token into logout', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(reply(200, session)).mockResolvedValueOnce(reply(200, null));
    const client = createGoApiClient(new GoTransport(send));

    const me = await apiRaw(goAuthContract.me, { client, silent: true });
    expect(me.data.user.username).toBe('admin');
    await apiRaw(goAuthContract.logout, { client, silent: true });

    expect(send.mock.calls.map(([path]) => path)).toEqual(['/api/v1/auth/me', '/api/v1/auth/logout']);
    expect(new Headers((send.mock.calls[1][1] as RequestInit).headers).get('X-CSRF-Token')).toBe('csrf-from-go');
  });

  it('passes only the Go login fields and does not require a preexisting CSRF token', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(reply(200, session));
    const client = createGoApiClient(new GoTransport(send));
    const body = { username: 'admin', password: 'example', captchaId: 'challenge', captchaAnswer: 'ABC123' };

    const result = await apiRaw(goAuthContract.login, { body }, { client, silent: true });
    expect(result.code).toBe(0);
    expect(send.mock.calls[0][0]).toBe('/api/v1/auth/login');
    expect(JSON.parse((send.mock.calls[0][1] as RequestInit).body as string)).toEqual(body);
    expect(new Headers((send.mock.calls[0][1] as RequestInit).headers).has('X-CSRF-Token')).toBe(false);
  });
});
