export interface Envelope<T> { code: number; message: string; data: T }
export interface User { id: number; username: string; nickname: string; tenantId: number | null; status: string; email?: string | null; preferences?: Record<string, unknown> }
export interface Session { user: User; csrfToken: string; tenantViewId: number | null; superAdmin: boolean; permissions?: string[] }
export class ApiError extends Error { constructor(message: string, readonly status: number) { super(message); } }

let csrf = '';
export function setCsrf(value: string) { csrf = value; }

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  if (init.method && !['GET', 'HEAD'].includes(init.method.toUpperCase())) headers.set('X-CSRF-Token', csrf);
  const response = await fetch(`/api/v1${path}`, { ...init, headers, credentials: 'same-origin' });
  let envelope: Envelope<T>;
  try { envelope = await response.json() as Envelope<T>; } catch { throw new ApiError(`请求失败 (${response.status})`, response.status); }
  if (!response.ok || envelope.code !== 0) throw new ApiError(envelope.message || `请求失败 (${response.status})`, response.status);
  return envelope.data;
}

export function operation<T>(op: { method: string; fullPath: string }, args: { id?: number; params?: Record<string, string | number>; query?: Record<string, string | number | undefined>; body?: unknown } = {}) {
  const params: Record<string, string | number | undefined> = { ...args.params, ...(args.id === undefined ? {} : { id: args.id }) };
  const suffix = op.fullPath.replace(/^\/api/, '').replace(/\{([^}]+)\}/g, (_, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`缺少路径参数 ${name}`);
    return encodeURIComponent(String(value));
  });
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(args.query ?? {})) if (value !== undefined && value !== '') search.set(key, String(value));
  return request<T>(`${suffix}${search.size ? `?${search}` : ''}`, { method: op.method.toUpperCase(), body: args.body === undefined ? undefined : JSON.stringify(args.body) });
}

export async function downloadOperation(op: { method: string; fullPath: string }, body: unknown): Promise<Blob> {
  const response = await fetch(op.fullPath.replace(/^\/api/, '/api/v1'), {
    method: op.method.toUpperCase(),
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    try {
      const envelope = await response.json() as Envelope<null>;
      throw new ApiError(envelope.message || `下载失败 (${response.status})`, response.status);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(`下载失败 (${response.status})`, response.status);
    }
  }
  return response.blob();
}

export function uploadOne<T>(file: File, visibility: 'public' | 'restricted', onProgress?: (percent: number) => void, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/v1/files/upload-one?visibility=${visibility}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('X-CSRF-Token', csrf);
    xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress?.(Math.round(event.loaded * 100 / event.total)); };
    xhr.onerror = () => reject(new ApiError('上传失败', xhr.status));
    xhr.onabort = () => reject(new ApiError('上传已取消', 0));
    xhr.onload = () => {
      try {
        const envelope = JSON.parse(xhr.responseText) as Envelope<T>;
        if (xhr.status < 200 || xhr.status >= 300 || envelope.code !== 0) reject(new ApiError(envelope.message || '上传失败', xhr.status));
        else resolve(envelope.data);
      } catch { reject(new ApiError(`上传失败 (${xhr.status})`, xhr.status)); }
    };
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    if (signal?.aborted) { xhr.abort(); return; }
    const body = new FormData(); body.append('file', file); xhr.send(body);
  });
}

export const authApi = {
  captcha: () => request<{ captchaId: string; image: string }>('/auth/captcha'),
  me: async () => { const data = await request<Session>('/auth/me'); setCsrf(data.csrfToken); return data; },
  login: async (values: { username: string; password: string; tenantCode: string; captchaId: string; captchaAnswer: string }) => {
    const data = await request<Session>('/auth/login', { method: 'POST', body: JSON.stringify(values) }); setCsrf(data.csrfToken); return data;
  },
  logout: async () => { await request<null>('/auth/logout', { method: 'POST' }); setCsrf(''); },
  profile: (nickname: string, email: string) => request<User>('/auth/profile', { method: 'PUT', body: JSON.stringify({ nickname, email }) }),
  preferences: (preferences: Record<string, unknown>) => request<Record<string, unknown>>('/auth/preferences', { method: 'PUT', body: JSON.stringify(preferences) }),
  changePassword: (currentPassword: string, newPassword: string) => request<null>('/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }),
  sessions: () => request<{ id: number; createdAt: string; expiresAt: string; current: boolean }[]>('/auth/sessions'),
  revokeSession: (id: number) => request<null>(`/auth/sessions/${id}`, { method: 'DELETE' }),
  switchTenantView: (tenantId: number | null) => request<{ tenantViewId: number | null }>('/auth/tenant-view', { method: 'PUT', body: JSON.stringify({ tenantId }) }),
};
