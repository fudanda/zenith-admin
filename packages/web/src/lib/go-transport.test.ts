import { describe, expect, it, vi } from 'vitest';
import { GoTransport, GoTransportError } from './go-transport';

function reply(status: number, data: unknown) {
  return new Response(JSON.stringify({ code: status === 200 ? 0 : status, message: status === 200 ? 'success' : 'error', data }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('Go cookie and CSRF transport', () => {
  it('sends avatar multipart bytes with Cookie and CSRF without overriding the browser boundary', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(reply(200, { id: 1 }));
    const client = new GoTransport(send);
    client.setCsrfToken('avatar-csrf');
    const body = new FormData();
    body.append('file', new Blob(['image'], { type: 'image/png' }), 'avatar.png');
    await client.request('POST', '/api/v1/auth/avatar', { body });
    const init = send.mock.calls[0][1] as RequestInit;
    expect(init.body).toBe(body);
    expect(init.credentials).toBe('same-origin');
    expect(new Headers(init.headers).get('X-CSRF-Token')).toBe('avatar-csrf');
    expect(new Headers(init.headers).has('Content-Type')).toBe(false);
  });

  it('restores a cookie session and uses its CSRF token for writes', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(reply(200, { csrfToken: 'server-csrf' })).mockResolvedValueOnce(reply(200, null));
    const client = new GoTransport(send);
    const restored = await client.request<{ csrfToken: string }>('GET', '/api/v1/auth/me');
    client.setCsrfToken(restored.data.csrfToken);
    await client.request('POST', '/api/v1/auth/logout');

    expect(send).toHaveBeenCalledTimes(2);
    const readInit = send.mock.calls[0][1] as RequestInit;
    const writeInit = send.mock.calls[1][1] as RequestInit;
    expect(readInit.credentials).toBe('same-origin');
    expect(writeInit.credentials).toBe('same-origin');
    expect(new Headers(readInit.headers).has('Authorization')).toBe(false);
    expect(new Headers(writeInit.headers).get('X-CSRF-Token')).toBe('server-csrf');
  });

  it('refuses authenticated writes before session restoration', async () => {
    const send = vi.fn<typeof fetch>();
    const client = new GoTransport(send);
    await expect(client.request('PUT', '/api/v1/users/1', { body: { nickname: 'A' } })).rejects.toMatchObject({ reason: 'session_missing' });
    expect(send).not.toHaveBeenCalled();
  });

  it('allows a login write without CSRF but clears the token after a rejected session', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(reply(200, { csrfToken: 'new-csrf' })).mockResolvedValueOnce(reply(401, null));
    const client = new GoTransport(send);
    const login = await client.request<{ csrfToken: string }>('POST', '/api/v1/auth/login', {
      body: { username: 'admin', password: 'secret', captchaId: 'id', captchaAnswer: 'answer' },
      anonymousWrite: true,
    });
    expect(new Headers((send.mock.calls[0][1] as RequestInit).headers).has('X-CSRF-Token')).toBe(false);
    client.setCsrfToken(login.data.csrfToken);
    await client.request('GET', '/api/v1/auth/me');
    await expect(client.request('POST', '/api/v1/auth/logout')).rejects.toBeInstanceOf(GoTransportError);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('rejects paths outside the Go API without sending credentials', async () => {
    const send = vi.fn<typeof fetch>();
    const client = new GoTransport(send);
    await expect(client.request('GET', 'https://example.test/api/v1/auth/me')).rejects.toThrow('Invalid Go API path');
    expect(send).not.toHaveBeenCalled();
  });

  it('supports original dictionary codes and streams files without accepting traversal or JSON as files', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(reply(200, [])).mockResolvedValueOnce(new Response('name,code', { headers: { 'Content-Type': 'text/csv' } })).mockResolvedValueOnce(reply(200, null));
    const client = new GoTransport(send);
    await client.request('GET', '/api/v1/dicts/code/common_status/items');
    expect(await (await client.readBlob('/api/v1/positions/export')).text()).toBe('name,code');
    await expect(client.readBlob('/api/v1/positions/export')).rejects.toMatchObject({ reason: 'invalid_response' });
    await expect(client.request('GET', '/api/v1/%2e%2e/%2e%2e/admin')).rejects.toThrow('Invalid Go API path');
    expect(send).toHaveBeenCalledTimes(3);
  });
});
