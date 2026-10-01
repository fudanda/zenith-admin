import { describe, expect, it, vi } from 'vitest';
import { Client } from './client';

describe('client expiry subscriptions', () => {
  it('ignores a late protected response when the host transport resolves after abort', async () => {
    let complete!: (response: Response) => void;
    const callback = vi.fn();
    const controller = new AbortController();
    const client = new Client({ onUnauthorized: callback, transport: () => new Promise(resolve => { complete = resolve; }) });
    const pending = client.get('/api/v1/auth/me', { signal: controller.signal });
    const cancelled = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    complete(new Response(JSON.stringify({ code: 401, message: 'expired', data: null }), { status: 401 }));
    await cancelled;
    expect(callback).not.toHaveBeenCalled();
  });
  it('preserves the caller callback, skips failed login and detaches observers', async () => {
    const callback = vi.fn();
    const listener = vi.fn();
    const client = new Client({ onUnauthorized: callback, transport: async () => new Response(JSON.stringify({ code: 401, message: 'expired', data: null }), { status: 401 }) });
    const unsubscribe = client.subscribeUnauthorized(listener);
    await client.post('/api/v1/auth/login', {});
    expect(listener).not.toHaveBeenCalled();
    await client.get('/api/v1/auth/me');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledTimes(1);
    unsubscribe();
    await client.get('/api/v1/auth/me');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledTimes(2);
  });
});
