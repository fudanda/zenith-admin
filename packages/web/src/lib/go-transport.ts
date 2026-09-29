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

  async request<T>(method: GoMethod, path: string, options: GoRequestOptions = {}): Promise<GoResponse<T>> {
    if (!/^\/api\/v1\/[a-z0-9][a-z0-9/-]*(?:\?[a-zA-Z0-9%=&_.+-]*)?$/.test(path) || path.includes('//')) {
      throw new Error('Invalid Go API path');
    }
    if (options.anonymousWrite && (method !== 'POST' || path !== '/api/v1/auth/login')) {
      throw new Error('Only password login may write without CSRF');
    }
    const write = method !== 'GET';
    if (write && !options.anonymousWrite && !this.csrfToken) {
      throw new GoTransportError(401, 'session_missing', '登录状态尚未恢复');
    }
    const headers = new Headers();
    if (options.body !== undefined) headers.set('Content-Type', 'application/json');
    if (write && !options.anonymousWrite) headers.set('X-CSRF-Token', this.csrfToken!);

    const response = await this.send(path, {
      method,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: options.signal,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
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
