import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoAuthProvider } from './GoAuthProvider';
import { goSessionKey } from '../lib/go-session';
import { useAuth } from '@/hooks/useAuth';
import { goTransport } from '@/lib/go-transport';
import { TOKEN_KEY, REFRESH_TOKEN_KEY } from '@arcbase/shared/core';

const session = {
  user: { id: 1, username: 'admin', nickname: '管理员', tenantId: null, status: 'enabled', email: null, roles: [], passwordUpdatedAt: '2026-09-30T00:00:00Z', createdAt: '2026-09-30T00:00:00Z', updatedAt: '2026-09-30T00:00:00Z' },
  permissions: ['*'], csrfToken: 'server-csrf', superAdmin: true,
};
const reply = (status: number, data: unknown = null) => new Response(JSON.stringify({ code: status === 200 ? 0 : status, message: status === 200 ? 'success' : 'unavailable', data }), { status });
const send = vi.fn<typeof fetch>();
let qc: QueryClient;

function Wrapper({ children }: Readonly<{ children: ReactNode }>) {
  return <QueryClientProvider client={qc}><GoAuthProvider>{children}</GoAuthProvider></QueryClientProvider>;
}

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  send.mockReset();
  vi.stubGlobal('fetch', send);
  vi.stubGlobal('BroadcastChannel', undefined);
  goTransport.clearSession();
  localStorage.clear();
});
afterEach(() => { cleanup(); qc.clear(); vi.unstubAllGlobals(); });

describe('original shell Go session provider', () => {
  it('keeps its mounted session observer through login/logout and clears other identities', async () => {
    localStorage.setItem(TOKEN_KEY, 'legacy-token');
    localStorage.setItem(REFRESH_TOKEN_KEY, 'legacy-refresh');
    send.mockResolvedValueOnce(reply(401)).mockResolvedValueOnce(reply(200, session)).mockResolvedValueOnce(reply(200));
    const { result } = renderHook(useAuth, { wrapper: Wrapper });
    await waitFor(() => expect(result.current.status).toBe('anonymous'));
    qc.setQueryData(['positions', 'list'], ['previous-account']);
    await act(async () => { await result.current.login('admin', 'example', 'captcha', 'ABC123'); });
    await waitFor(() => expect(result.current.status).toBe('authenticated'));
    expect(result.current.user?.username).toBe('admin');
    expect(qc.getQueryData(['positions', 'list'])).toBeUndefined();
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
    qc.setQueryData(['positions', 'list'], ['current-account']);
    act(() => result.current.logout());
    await waitFor(() => expect(result.current.status).toBe('anonymous'));
    expect(qc.getQueryData(goSessionKey)).toBeNull();
    expect(qc.getQueryData(['positions', 'list'])).toBeUndefined();
    expect(new Headers(send.mock.calls[2][1]?.headers).get('X-CSRF-Token')).toBe('server-csrf');
    await expect(goTransport.request('POST', '/api/v1/auth/logout')).rejects.toMatchObject({ reason: 'session_missing' });
  });

  it('recovers a cookie session after temporary database failure and then accepts revocation', async () => {
    send.mockResolvedValueOnce(reply(503)).mockResolvedValueOnce(reply(200, session)).mockResolvedValueOnce(reply(401));
    const { result } = renderHook(useAuth, { wrapper: Wrapper });
    await waitFor(() => expect(result.current.status).toBe('unavailable'));
    await act(async () => { await result.current.refresh(); });
    await waitFor(() => expect(result.current.status).toBe('authenticated'));
    await act(async () => { await result.current.refresh(); });
    await waitFor(() => expect(result.current.status).toBe('anonymous'));
    expect(result.current.permissions).toEqual([]);
  });
});
