/** Transport for the Go first-release API. The session secret stays in an HttpOnly cookie. */
export interface GoResponse<T> {
  code: number;
  message: string;
  data: T;
  error?: string;
}

export class GoTransportError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
    message: string,
  ) {
    super(message);
    this.name = 'GoTransportError';
  }
}

type GoMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export const GO_SESSION_INVALIDATED = 'zenith:go-session-invalidated';

export function validateGoPath(path: string): void {
  if (!/^\/api\/v1\/[a-zA-Z0-9][a-zA-Z0-9_%./-]*(?:\?[a-zA-Z0-9%=&_.+-]*)?$/.test(path) || path.includes('//') || /(?:^|\/)\.{1,2}(?:\/|$)/.test(decodeURIComponent(path.split('?')[0])) || !new URL(path, 'http://localhost').pathname.startsWith('/api/v1/')) {
    throw new Error('Invalid Go API path');
  }
}

interface GoRequestOptions {
  body?: unknown;
  signal?: AbortSignal;
  /** Login creates a session and has no CSRF token yet; Go checks its Origin. */
  anonymousWrite?: boolean;
}

export class GoTransport {
  private csrfToken: string | null = null;

  constructor(private readonly send: typeof fetch = (...args) => globalThis.fetch(...args)) {}

  setCsrfToken(value: string | null): void {
    this.csrfToken = value;
  }

  clearSession(): void {
    this.csrfToken = null;
  }

  sessionHeaders(): Record<string, string> {
    return this.csrfToken ? { 'X-CSRF-Token': this.csrfToken } : {};
  }

  async readBlob(path: string): Promise<Blob> {
    validateGoPath(path);
    const response = await this.send(path, { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) {
      if (response.status === 401) {
        this.clearSession();
        globalThis.dispatchEvent(new Event(GO_SESSION_INVALIDATED));
      }
      const result = await response.json() as { message?: string; error?: string };
      throw new GoTransportError(response.status, result.error ?? 'download_failed', result.message ?? '下载失败');
    }
    if (response.headers.get('Content-Type')?.includes('application/json')) throw new GoTransportError(response.status, 'invalid_response', '文件响应格式错误');
    return response.blob();
  }

  async request<T>(method: GoMethod, path: string, options: GoRequestOptions = {}): Promise<GoResponse<T>> {
    validateGoPath(path);
    if (options.anonymousWrite && (method !== 'POST' || !['/api/v1/auth/login', '/api/v1/auth/session-conflict/resolve'].includes(path))) {
      throw new Error('Only origin-checked login actions may write without CSRF');
    }
    const write = method !== 'GET';
    if (write && !options.anonymousWrite && !this.csrfToken) {
      throw new GoTransportError(401, 'session_missing', '登录状态尚未恢复');
    }
    const headers = new Headers();
    const multipart = typeof FormData !== 'undefined' && options.body instanceof FormData;
    if (options.body !== undefined && !multipart) headers.set('Content-Type', 'application/json');
    if (write && !options.anonymousWrite) headers.set('X-CSRF-Token', this.csrfToken!);

    const response = await this.send(path, {
      method,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: options.signal,
      ...(options.body === undefined ? {} : { body: multipart ? options.body as FormData : JSON.stringify(options.body) }),
    });
    if (response.status === 401) this.clearSession();
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== 'object' || !('code' in payload) || !('message' in payload)) {
      throw new GoTransportError(response.status, 'invalid_response', '服务端响应格式错误');
    }
    const envelope = payload as GoResponse<T>;
    if (typeof envelope.code !== 'number' || typeof envelope.message !== 'string') {
      throw new GoTransportError(response.status, 'invalid_response', '服务端响应格式错误');
    }
    return envelope;
  }
}

export const goTransport = new GoTransport();
