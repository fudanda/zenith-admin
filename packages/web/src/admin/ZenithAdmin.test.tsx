import { StrictMode, useEffect } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { Client } from '@zenith/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '@/hooks/useAuth';
import { useAdminPaths } from './runtime';
import { ZenithAdmin } from './ZenithAdmin';
import { goTransport, GO_SESSION_INVALIDATED } from '@/lib/go-transport';
import { createCookieSession } from '@zenith/elements';

vi.mock('@monaco-editor/react', () => ({ loader: { config: vi.fn() } }));
vi.mock('../App', () => ({ default: function Probe() {
  const auth = useAuth();
  const paths = useAdminPaths();
  useEffect(() => { document.body.style.setProperty('--host-test', 'admin'); }, []);
  return <div>{auth.status}:{auth.user?.username}:{paths.basePath}:{paths.assetBasePath}</div>;
} }));

const session = {
  user: { id: 1, username: 'host-admin', nickname: '管理员', status: 'enabled', email: null, roles: [], passwordUpdatedAt: '2026-09-30T00:00:00Z', createdAt: '2026-09-30T00:00:00Z', updatedAt: '2026-09-30T00:00:00Z' },
  permissions: ['*'], csrfToken: 'host-csrf', superAdmin: true,
};
const reply = (status: number, data: unknown = null) => new Response(JSON.stringify({ code: status === 200 ? 0 : status, message: 'response', data }), { status });

beforeEach(() => { vi.stubGlobal('BroadcastChannel', undefined); localStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.body.removeAttribute('style'); });

describe('original Zenith admin host', () => {
  it('reuses a host-owned session without a second /me query and restores the host language/title', async () => {
    const send = vi.fn<typeof fetch>().mockImplementation(async () => reply(200, session));
    const client = new Client({ transport: send });
    const adapter = createCookieSession(client); await adapter.refresh();
    document.title = 'Host application'; document.documentElement.lang = 'zh-CN';
    const host = render(<ZenithAdmin client={client} authSession={adapter} locale="en-US" brand={{ name: 'Acme console' }} />);
    await screen.findByText(/authenticated:host-admin/);
    expect(send.mock.calls.filter(([url]) => String(url).endsWith('/auth/me'))).toHaveLength(1);
    expect(document.documentElement.lang).toBe('en-US');
    host.unmount(); adapter.dispose();
    expect(document.title).toBe('Host application');
    expect(document.documentElement.lang).toBe('zh-CN');
  });
  it('does not repeatedly refresh an expired host-owned session on /me 401 responses', async () => {
    const send = vi.fn<typeof fetch>().mockImplementation(async () => reply(200, session));
    const client = new Client({ transport: send }); const adapter = createCookieSession(client);
    await adapter.refresh(); const host = render(<ZenithAdmin client={client} authSession={adapter} />);
    await screen.findByText(/authenticated:host-admin/);
    send.mockImplementation(async () => reply(401));
    await act(async () => { await goTransport.get('/api/v1/positions'); });
    await screen.findByText(/anonymous/);
    expect(send.mock.calls.filter(([url]) => String(url).endsWith('/auth/me'))).toHaveLength(2);
    host.unmount(); adapter.dispose();
  });
  it('restores the supplied client, owns the cache and forwards imperative file/JSON requests', async () => {
    const send = vi.fn<typeof fetch>().mockImplementation(async () => reply(200, session));
    const client = new Client({ baseURL: 'https://backend.example', transport: send });
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const nativeStorage = window.localStorage;
    nativeStorage.setItem('host-owned', 'preserved');
    document.body.style.setProperty('--host-test', 'before');
    const host = render(<ZenithAdmin client={client} queryClient={cache} basePath="/console/" assetBasePath="/local-assets/" />);
    await screen.findByText(/authenticated:host-admin:\/console:/);
    expect(String(send.mock.calls[0][0])).toBe('https://backend.example/api/v1/auth/me');
    expect(client.sessionHeaders()['X-CSRF-Token']).toBe('host-csrf');
    send.mockResolvedValueOnce(reply(200));
    await goTransport.request('POST', '/api/v1/positions', { body: { code: 'host' } });
    expect(new Headers(send.mock.calls.at(-1)?.[1]?.headers).get('X-CSRF-Token')).toBe('host-csrf');
    send.mockResolvedValueOnce(new Response('file', { headers: { 'Content-Type': 'text/plain' } }));
    expect(await (await goTransport.readBlob('/api/v1/files/1/download')).text()).toBe('file');
    cache.setQueryData(['private-host-data'], [1]);
    host.unmount();
    expect(cache.getQueryCache().getAll()).toHaveLength(0);
    expect(document.body.style.getPropertyValue('--host-test')).toBe('before');
    expect(window.localStorage).toBe(nativeStorage);
    expect(window.localStorage.getItem('host-owned')).toBe('preserved');
    // Unmount leaves a host-owned client and the server session usable.
    expect(client.sessionHeaders()['X-CSRF-Token']).toBe('host-csrf');
  });

  it('aborts in-flight requests, removes expiry observers and can remount under StrictMode', async () => {
    const send = vi.fn<typeof fetch>().mockImplementation(async () => reply(200, session));
    const client = new Client({ transport: send });
    const invalidated = vi.fn();
    globalThis.addEventListener(GO_SESSION_INVALIDATED, invalidated);
    const host = render(<StrictMode><ZenithAdmin client={client} /></StrictMode>);
    await screen.findByText(/authenticated:host-admin/);
    send.mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true });
    }));
    const pending = goTransport.fetchRaw('/api/v1/files/1/download');
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    host.unmount();
    await rejected;
    send.mockResolvedValueOnce(reply(401));
    await client.get('/api/v1/auth/me');
    expect(invalidated).not.toHaveBeenCalled();
    render(<ZenithAdmin client={client} />);
    await screen.findByText(/authenticated:host-admin/);
    globalThis.removeEventListener(GO_SESSION_INVALIDATED, invalidated);
  });

  it('invalidates the active session immediately on a protected 401', async () => {
    const send = vi.fn<typeof fetch>().mockImplementation(async () => reply(200, session));
    const host = render(<ZenithAdmin client={new Client({ transport: send })} />);
    await screen.findByText(/authenticated:host-admin/);
    send.mockResolvedValueOnce(reply(401));
    await act(async () => { await goTransport.get('/api/v1/positions'); });
    await screen.findByText(/anonymous/);
    host.unmount();
  });

  it('rejects a second host and changing the client with a reviewable fallback', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = new Client({ transport: async () => reply(200, session) });
    const first = render(<ZenithAdmin client={client} />);
    await screen.findByText(/authenticated:host-admin/);
    const second = render(<ZenithAdmin client={client} errorFallback={error => <span>{error.message}</span>} />);
    await screen.findByText('Only one ZenithAdmin can be mounted in a document');
    second.unmount();
    first.rerender(<ZenithAdmin client={new Client()} errorFallback={error => <span>{error.message}</span>} />);
    await waitFor(() => expect(screen.getByText('Remount ZenithAdmin to change its client, cache or paths')).toBeInTheDocument());
    log.mockRestore();
  });
});
