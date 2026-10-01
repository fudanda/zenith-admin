import { describe, expect, it, vi } from 'vitest';
import { Client, ClientError } from './index';

function reply(status = 200, data: unknown = null, headers: HeadersInit = {}) {
  return new Response(JSON.stringify({ code: status === 200 ? 0 : status, message: status === 200 ? 'ok' : 'denied', data }), { status, headers });
}

describe('standalone client', () => {
  it('uses injected transport without browser state, sends business headers and protects identity', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(reply(200, null, { 'X-Request-Id': 'trace-a' }));
    const client = new Client({ baseURL: 'https://admin.example', credentials: 'include', transport: send });
    client.setCsrfToken('current');
    const headers = new Headers({ Authorization: 'Bearer stale', Cookie: 'secret', 'X-CSRF-Token': 'stale', 'X-Intent': 'intent' });
    const result = await client.put('/api/v1/users/1', { nickname: 'A' }, { headers });
    const init = send.mock.calls[0][1]!;
    expect(send.mock.calls[0][0]).toBe('https://admin.example/api/v1/users/1');
    expect(Object.fromEntries(new Headers(init.headers))).toEqual({ 'content-type': 'application/json', 'x-csrf-token': 'current', 'x-intent': 'intent' });
    expect(init.credentials).toBe('include');
    expect(result.requestId).toBe('trace-a');
    expect(headers.get('Authorization')).toBe('Bearer stale');
  });

  it('rejects unsafe paths and writes without a restored session before sending', async () => {
    const send = vi.fn<typeof fetch>();
    const client = new Client({ transport: send });
    for (const path of ['https://other.test/api/v1/me', '/api/users', '/api/v1/%2e%2e/admin', '/api/v1/files/%2F%2Fother.test']) {
      await expect(client.get(path)).rejects.toThrow();
    }
    await expect(client.put('/api/v1/users/1', {})).rejects.toMatchObject({ reason: 'session_missing' });
    await expect(client.request('POST', '/api/v1/users', { anonymousWrite: true })).rejects.toThrow('Only origin-checked');
    expect(send).not.toHaveBeenCalled();
  });

  it('clears CSRF and notifies the host once for rejected JSON, raw and download requests', async () => {
    const onUnauthorized = vi.fn();
    const send = vi.fn<typeof fetch>().mockImplementation(async () => reply(401));
    const client = new Client({ transport: send, onUnauthorized });
    for (const action of [() => client.get('/api/v1/auth/me'), () => client.fetchRaw('/api/v1/auth/me'), () => client.readBlob('/api/v1/files/1/private-content')]) {
      client.setCsrfToken('active');
      await action().catch(() => {});
      expect(client.sessionHeaders()).toEqual({});
    }
    expect(onUnauthorized).toHaveBeenCalledTimes(3);
    await client.post('/api/v1/auth/login', { username: 'wrong' });
    expect(onUnauthorized).toHaveBeenCalledTimes(3);
  });

  it('preserves the session on database outage and refuses malformed success responses', async () => {
    const onUnauthorized = vi.fn();
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(reply(503)).mockResolvedValueOnce(new Response('<html>failure</html>')).mockResolvedValueOnce(reply(503, null));
    const client = new Client({ transport: send, onUnauthorized });
    client.setCsrfToken('active');
    expect((await client.get('/api/v1/auth/me')).code).toBe(503);
    expect(client.sessionHeaders()).toEqual({ 'X-CSRF-Token': 'active' });
    expect(onUnauthorized).not.toHaveBeenCalled();
    await expect(client.get('/api/v1/auth/me')).rejects.toBeInstanceOf(ClientError);
    await expect(client.readBlob('/api/v1/files/1/private-content')).rejects.toMatchObject({ status: 503 });
  });

  it('uploads multipart with the same Cookie/CSRF headers and does not set a boundary', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(reply());
    const client = new Client({ transport: send });
    client.setCsrfToken('upload-csrf');
    const form = new FormData();
    form.append('file', new Blob(['bytes']), 'test.txt');
    const controller = new AbortController();
    await client.postForm('/api/v1/files/upload-one', form, { headers: { 'Content-Type': 'multipart/form-data', 'X-Intent': 'upload' }, signal: controller.signal });
    const init = send.mock.calls[0][1]!;
    expect(init.body).toBe(form);
    expect(init.signal).toBe(controller.signal);
    expect(new Headers(init.headers).has('Content-Type')).toBe(false);
    expect(new Headers(init.headers).get('X-CSRF-Token')).toBe('upload-csrf');
  });

  it('downloads POST ZIP responses with CSRF and keeps cancellation distinct from a network failure', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('zip-bytes', { headers: { 'Content-Type': 'application/zip' } })).mockRejectedValueOnce(new DOMException('stop', 'AbortError')).mockRejectedValueOnce(new TypeError('network'));
    const client = new Client({ transport: send });
    client.setCsrfToken('csrf');
    const blob = await client.readBlob('/api/v1/files/batch-download', { method: 'POST', body: '{"ids":["1"]}' });
    expect(await blob.text()).toBe('zip-bytes');
    expect(new Headers(send.mock.calls[0][1]!.headers).get('X-CSRF-Token')).toBe('csrf');
    await expect(client.get('/api/v1/auth/me')).rejects.toMatchObject({ name: 'AbortError' });
    await expect(client.get('/api/v1/auth/me')).rejects.toMatchObject({ reason: 'network_error' });
  });

  it('permits real JSON files and rejects API envelopes returned as a download', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('{"setting":true}', { headers: { 'Content-Type': 'application/json', 'Content-Disposition': 'inline; filename="config.json"' } })).mockResolvedValueOnce(reply(200, null, { 'Content-Type': 'application/json' }));
    const client = new Client({ transport: send });
    expect(await (await client.readBlob('/api/v1/files/1/private-content')).text()).toBe('{"setting":true}');
    await expect(client.readBlob('/api/v1/files/2/private-content')).rejects.toMatchObject({ reason: 'invalid_response' });
  });
});

class UploadXHR extends EventTarget {
  upload = new EventTarget();
  headers = new Headers();
  status = 200;
  responseText = JSON.stringify({ code: 0, message: 'ok', data: { id: '1' } });
  withCredentials = false;
  open = vi.fn();
  setRequestHeader(name: string, value: string) { this.headers.set(name, value); }
  getResponseHeader(name: string) { return name.toLowerCase() === 'content-type' ? 'application/json' : null; }
  abort() { this.dispatchEvent(new Event('abort')); }
  send() {}
  complete() {
    this.upload.dispatchEvent(Object.assign(new Event('progress'), { lengthComputable: true, loaded: 5, total: 10 }));
    this.dispatchEvent(new Event('load'));
  }
}

describe('progress transport', () => {
  it('uses identical credentials and current headers to fetch uploads, and reports progress', async () => {
    const xhr = new UploadXHR();
    const onProgress = vi.fn();
    const client = new Client({ credentials: 'include', xhrFactory: () => xhr as unknown as XMLHttpRequest });
    client.setCsrfToken('active');
    const pending = client.postForm('/api/v1/files/upload-one', new FormData(), { onProgress, headers: { Authorization: 'stale', 'Content-Type': 'multipart/form-data', 'X-Intent': 'upload' } });
    xhr.complete();
    expect((await pending).code).toBe(0);
    expect(xhr.withCredentials).toBe(true);
    expect(Object.fromEntries(xhr.headers)).toEqual({ 'x-csrf-token': 'active', 'x-intent': 'upload' });
    expect(onProgress).toHaveBeenCalledWith(50);
  });

  it('aborts the real upload when signaled, and invalidates rejected upload sessions', async () => {
    const xhr = new UploadXHR();
    const onUnauthorized = vi.fn();
    const client = new Client({ xhrFactory: () => xhr as unknown as XMLHttpRequest, onUnauthorized });
    client.setCsrfToken('active');
    const controller = new AbortController();
    const pending = client.postForm('/api/v1/files/upload-one', new FormData(), { onProgress: vi.fn(), signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    const rejected = client.postForm('/api/v1/files/upload-one', new FormData(), { onProgress: vi.fn() });
    xhr.status = 401;
    xhr.responseText = JSON.stringify({ code: 401, message: 'expired', data: null });
    xhr.complete();
    expect((await rejected).code).toBe(401);
    expect(client.sessionHeaders()).toEqual({});
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
});
