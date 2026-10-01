import type { ApiResponse } from '@zenith/shared/core';
import { ClientError } from './errors';

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type ApiEnvelope<T> = ApiResponse<T> & { error?: string; requestId?: string; retryAfterSeconds?: number };
export interface RequestOptions {
  signal?: AbortSignal | null;
  headers?: HeadersInit;
  anonymousWrite?: boolean;
}
export interface ClientOptions {
  baseURL?: string;
  credentials?: RequestCredentials;
  transport?: typeof fetch;
  xhrFactory?: () => XMLHttpRequest;
  onUnauthorized?: () => void;
  /** For scripts/server integrations. Never persist or expose keys in browser storage. */
  apiKey?: string;
}

const loginPaths = ['/api/v1/auth/login', '/api/v1/auth/session-conflict/resolve'];

export function validateGoPath(path: string): void {
  if (!/^\/api\/v1\/[a-zA-Z0-9][a-zA-Z0-9_%./-]*(?:\?[a-zA-Z0-9%=&_.+-]*)?$/.test(path)
    || path.includes('//')
    || decodeURIComponent(path.split('?')[0]).includes('//')
    || /(?:^|\/)\.{1,2}(?:\/|$)/.test(decodeURIComponent(path.split('?')[0]))
    || !new URL(path, 'http://localhost').pathname.startsWith('/api/v1/')) {
    throw new Error('Invalid Go API path');
  }
}

/** Cookie/CSRF transport. UI, user state and query caches belong to the host. */
export class Client {
  private csrfToken: string | null = null;
  private readonly unauthorizedListeners = new Set<() => void>();
  private readonly baseURL: string;
  private readonly send: typeof fetch;
  private readonly credentials: RequestCredentials;

  constructor(private readonly options: ClientOptions = {}) {
    this.baseURL = (options.baseURL ?? '').replace(/\/$/, '');
    if (this.baseURL && (!/^https?:\/\//.test(this.baseURL) || new URL(this.baseURL).origin !== this.baseURL)) throw new Error('baseURL must be an HTTP origin');
    this.send = options.transport ?? ((...args) => globalThis.fetch(...args));
    if (options.apiKey && !/^zen_[a-f0-9]{64}$/.test(options.apiKey)) throw new Error('Invalid Zenith API Key');
    this.credentials = options.credentials ?? (options.apiKey ? 'omit' : 'same-origin');
  }

  setCsrfToken(value: string | null): void { this.csrfToken = value; }
  clearSession(): void { this.csrfToken = null; }
  sessionHeaders(): Record<string, string> { return this.csrfToken ? { 'X-CSRF-Token': this.csrfToken } : {}; }

  /** Hosts can observe expiry without replacing the caller's callback. */
  subscribeUnauthorized(listener: () => void): () => void {
    this.unauthorizedListeners.add(listener);
    return () => { this.unauthorizedListeners.delete(listener); };
  }

  private headers(method: string, path: string, body: BodyInit | null | undefined, options: RequestOptions): Headers {
    validateGoPath(path);
    if (options.anonymousWrite && (method !== 'POST' || !loginPaths.includes(path))) throw new Error('Only origin-checked login actions may write without CSRF');
    const write = !['GET', 'HEAD', 'OPTIONS'].includes(method);
    if (write && !options.anonymousWrite && !this.csrfToken && !this.options.apiKey) throw new ClientError(401, 'session_missing', '登录状态尚未恢复');
    const headers = new Headers(options.headers);
    // Caller headers cannot supply a different identity or stale CSRF secret.
    headers.delete('authorization');
    headers.delete('cookie');
    headers.delete('x-csrf-token');
    if (this.options.apiKey) headers.set('Authorization', `Bearer ${this.options.apiKey}`);
    if (body instanceof FormData) headers.delete('content-type');
    else if (body !== undefined && body !== null && !headers.has('content-type')) headers.set('Content-Type', 'application/json');
    if (write && !options.anonymousWrite && !this.options.apiKey) headers.set('X-CSRF-Token', this.csrfToken!);
    return headers;
  }

  private received(status: number, anonymousWrite = false): void {
    if (status === 401) {
      this.clearSession();
      if (!anonymousWrite) {
        for (const listener of this.unauthorizedListeners) listener();
        this.options.onUnauthorized?.();
      }
    }
  }

  async fetchRaw(path: string, options: RequestInit & RequestOptions = {}): Promise<Response> {
    const { anonymousWrite, ...init } = options;
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = this.headers(method, path, init.body, { ...options, anonymousWrite });
    let response: Response;
    try { response = await this.send(this.baseURL + path, { ...init, method, headers, credentials: this.credentials, cache: 'no-store' }); }
    catch (error) {
      if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') throw error;
      throw new ClientError(0, 'network_error', '网络请求失败，请检查网络连接');
    }
    // A host transport may resolve after cancellation; ignore that stale result.
    if (init.signal?.aborted) throw new DOMException('已取消', 'AbortError');
    this.received(response.status, anonymousWrite);
    return response;
  }

  private async envelope<T>(response: Response): Promise<ApiEnvelope<T>> {
    const requestId = response.headers.get('X-Request-Id') ?? undefined;
    let payload: unknown;
    try { payload = await response.json(); }
    catch { throw new ClientError(response.status, 'invalid_response', '服务端响应格式错误', requestId); }
    if (!payload || typeof payload !== 'object' || !('code' in payload) || typeof payload.code !== 'number'
      || !('message' in payload) || typeof payload.message !== 'string' || !('data' in payload)) throw new ClientError(response.status, 'invalid_response', '服务端响应格式错误', requestId);
    const result = payload as ApiEnvelope<T>;
    if (!response.ok && result.code === 0) throw new ClientError(response.status, 'invalid_response', 'HTTP 状态与响应结果不一致', requestId);
    const retryAfterSeconds = Number(response.headers.get('Retry-After'));
    return { ...result, ...(requestId ? { requestId } : {}), ...(retryAfterSeconds > 0 ? { retryAfterSeconds } : {}) };
  }

  async request<T>(method: Method, path: string, options: RequestOptions & { body?: unknown } = {}): Promise<ApiEnvelope<T>> {
    const { body, ...rest } = options;
    const raw = body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body);
    return this.requestRaw<T>(path, { ...rest, method, body: raw });
  }

  async requestRaw<T>(path: string, options: RequestInit & RequestOptions = {}): Promise<ApiEnvelope<T>> {
    return this.envelope<T>(await this.fetchRaw(path, options));
  }

  get<T>(path: string, options?: RequestOptions) { return this.request<T>('GET', path, options); }
  post<T>(path: string, body?: unknown, options?: RequestOptions) { return this.request<T>('POST', path, { ...options, body, anonymousWrite: loginPaths.includes(path) }); }
  put<T>(path: string, body?: unknown, options?: RequestOptions) { return this.request<T>('PUT', path, { ...options, body }); }
  patch<T>(path: string, body?: unknown, options?: RequestOptions) { return this.request<T>('PATCH', path, { ...options, body }); }
  delete<T>(path: string, body?: unknown, options?: RequestOptions) { return this.request<T>('DELETE', path, { ...options, body }); }

  async readBlob(path: string, options: RequestInit & RequestOptions = {}): Promise<Blob> {
    const response = await this.fetchRaw(path, options);
    if (!response.ok) {
      const result = await this.envelope<unknown>(response);
      throw new ClientError(response.status, result.error ?? 'download_failed', result.message || '下载失败', result.requestId);
    }
    if (response.headers.get('Content-Type')?.includes('application/json') && !response.headers.has('Content-Disposition')) throw new ClientError(response.status, 'invalid_response', '文件响应格式错误');
    return response.blob();
  }

  async postForm<T>(path: string, body: FormData, options: RequestOptions & { onProgress?: (percent: number) => void } = {}): Promise<ApiEnvelope<T>> {
    if (!options.onProgress) return this.request<T>('POST', path, { ...options, body });
    const headers = this.headers('POST', path, body, options);
    if (options.signal?.aborted) throw new DOMException('已取消', 'AbortError');
    const xhr = this.options.xhrFactory?.() ?? new XMLHttpRequest();
    return new Promise((resolve, reject) => {
      xhr.open('POST', this.baseURL + path);
      xhr.withCredentials = this.credentials === 'include';
      headers.forEach((value, name) => xhr.setRequestHeader(name, value));
      const onProgress = (event: ProgressEvent) => {
        if (event.lengthComputable) options.onProgress?.(Math.round(event.loaded / event.total * 100));
      };
      const onAbort = () => { xhr.abort(); reject(new DOMException('已取消', 'AbortError')); };
      options.signal?.addEventListener('abort', onAbort, { once: true });
      const cleanup = () => {
        options.signal?.removeEventListener('abort', onAbort);
        xhr.upload.removeEventListener('progress', onProgress);
        xhr.removeEventListener('load', onLoad);
        xhr.removeEventListener('error', onError);
        xhr.removeEventListener('abort', onAborted);
        xhr.removeEventListener('timeout', onTimeout);
      };
      const onLoad = () => {
        cleanup();
        this.received(xhr.status);
        const responseHeaders = new Headers();
        for (const name of ['Content-Type', 'X-Request-Id', 'Retry-After']) {
          const value = xhr.getResponseHeader(name);
          if (value) responseHeaders.set(name, value);
        }
        try { void this.envelope<T>(new Response(xhr.responseText, { status: xhr.status, headers: responseHeaders })).then(resolve, reject); }
        catch (error) { reject(error); }
      };
      const onError = () => { cleanup(); reject(new ClientError(0, 'network_error', '网络请求失败，请检查网络连接')); };
      const onAborted = () => { cleanup(); reject(new DOMException('已取消', 'AbortError')); };
      const onTimeout = () => { cleanup(); reject(new ClientError(0, 'timeout', '上传超时')); };
      xhr.upload.addEventListener('progress', onProgress);
      xhr.addEventListener('load', onLoad);
      xhr.addEventListener('error', onError);
      xhr.addEventListener('abort', onAborted);
      xhr.addEventListener('timeout', onTimeout);
      try { xhr.send(body); }
      catch { cleanup(); reject(new ClientError(0, 'network_error', '网络请求失败，请检查网络连接')); }
    });
  }
}
