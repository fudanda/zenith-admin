import { TOKEN_KEY, REFRESH_TOKEN_KEY } from '@arcbase/shared/core';
import { authContract } from '@arcbase/shared/identity';
import type { ApiResponse } from '@arcbase/shared/core';
import { config } from '@/config';
import { HttpClient, type ApiResponseWithMeta, type HttpRequestOptions } from './http-client';
import { downloadBlob } from './download';
import { showRequestErrorToast } from './request-toast';
import { IS_GO_FOUNDATION } from '@/lib/foundation-mode';
import { goTransport, GO_SESSION_INVALIDATED } from '@/lib/go-transport';

export type { ApiResponseWithMeta } from './http-client';

export type RequestOptions = HttpRequestOptions;
export const ADMIN_AUTH_INVALIDATED_EVENT = 'auth:invalidated';

/**
 * 后台 admin 端 HTTP 客户端。
 * 通用逻辑（token 注入 / 401 刷新重试 / 429 / 错误提示）见 http-client.ts，
 * 本类额外提供带上传进度的 postForm 与二进制下载 download。
 */
class Request extends HttpClient {
  postForm<T>(url: string, body: FormData, opts: RequestOptions & { onProgress?: (percent: number) => void } = {}) {
    const { onProgress, ...restOpts } = opts;
    if (!onProgress) return this.request<T>(url, { method: 'POST', body, ...restOpts });
    // 有进度回调时改用 XMLHttpRequest（fetch 不支持上传进度）
    return new Promise<ApiResponseWithMeta<T>>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${this.baseUrl}${url}`);
      this.getHeaders(body, restOpts.headers).forEach((value, name) => xhr.setRequestHeader(name, value));
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
      });
      xhr.addEventListener('load', () => {
        if (IS_GO_FOUNDATION && xhr.status === 401) {
          goTransport.clearSession();
          globalThis.dispatchEvent(new Event(GO_SESSION_INVALIDATED));
        }
        try {
          const data = JSON.parse(xhr.responseText) as ApiResponse<T>;
          if (data.code !== 0 && !restOpts.silent) showRequestErrorToast(data.message || '操作失败');
          resolve(data);
        } catch {
          const errResp = { code: -1, message: '响应解析失败', data: null as unknown as T };
          if (!restOpts.silent) showRequestErrorToast(errResp.message);
          resolve(errResp);
        }
      });
      xhr.addEventListener('error', () => {
        const errResp = { code: -1, message: '网络请求失败，请检查网络连接', data: null as unknown as T };
        if (!restOpts.silent) showRequestErrorToast(errResp.message);
        resolve(errResp);
      });
      // 与 fetch 分支一致：signal 中止时终止请求，按失败响应返回（不弹提示，取消是调用方的主动行为）
      const { signal } = restOpts;
      if (signal) {
        const onAbort = () => { xhr.abort(); resolve({ code: -1, message: '已取消', data: null as unknown as T }); };
        if (signal.aborted) { onAbort(); return; }
        signal.addEventListener('abort', onAbort, { once: true });
        xhr.addEventListener('loadend', () => signal.removeEventListener('abort', onAbort));
      }
      xhr.send(body);
    });
  }

  /**
   * 拉取二进制响应（默认 GET，可传 method / body 走 POST 导出等）：复用 fetchRaw 的鉴权与 401 刷新重试，
   * 非 2xx 按统一错误提示处理。返回 null 表示失败已被处理（含跳转登录），调用方无需再提示。
   */
  async getBlob(url: string, options: RequestInit = {}): Promise<Blob | null> {
    const res = await this.fetchRaw(url, options);
    if (!res) return null;
    if (!res.ok) {
      try {
        const data = await res.json() as { message?: string };
        showRequestErrorToast(data?.message || '请求失败');
      } catch {
        showRequestErrorToast('请求失败');
      }
      return null;
    }
    return res.blob();
  }

  /** Download a file (binary response) - used for Excel export */
  async download(url: string, filename: string): Promise<void> {
    const blob = await this.getBlob(url);
    if (blob) downloadBlob(blob, filename);
  }
}

/** Retains ArcBase's upload progress and binary channels with Cookie/CSRF auth. */
class GoRequest extends Request {
  override authHeaders(): Record<string, string> { return goTransport.sessionHeaders(); }

  private failed<T>(error: unknown, silent?: boolean): ApiResponseWithMeta<T> {
    const canceled = error instanceof Error && error.name === 'AbortError';
    const message = canceled ? '已取消' : error instanceof Error ? error.message : '请求失败';
    if (!silent && !canceled) showRequestErrorToast(message);
    return { code: -1, message, data: null as T };
  }

  override async request<T>(url: string, options: RequestInit & RequestOptions = {}): Promise<ApiResponseWithMeta<T>> {
    const { silent, skipAuth: _skipAuth, ...init } = options;
    try {
      const result = await goTransport.requestRaw<T>(url, init);
      if (result.code !== 0 && !silent) showRequestErrorToast(result.message, result.requestId);
      return result;
    } catch (error) { return this.failed<T>(error, silent); }
  }

  override async fetchRaw(url: string, options: RequestInit & Pick<RequestOptions, 'silent'> = {}): Promise<Response | null> {
    const { silent, ...init } = options;
    try { const response = await goTransport.fetchRaw(url, init); return response.status === 401 ? null : response; }
    catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      this.failed(error, silent);
      return null;
    }
  }

  override async postForm<T>(url: string, body: FormData, options: RequestOptions & { onProgress?: (percent: number) => void } = {}): Promise<ApiResponseWithMeta<T>> {
    const { silent, skipAuth: _skipAuth, ...init } = options;
    try {
      const result = await goTransport.postForm<T>(url, body, init);
      if (result.code !== 0 && !silent) showRequestErrorToast(result.message, result.requestId);
      return result;
    } catch (error) { return this.failed<T>(error, silent); }
  }

  override async getBlob(url: string, options: RequestInit = {}): Promise<Blob | null> {
    try { return await goTransport.readBlob(url, options); }
    catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      this.failed(error);
      return null;
    }
  }
}

export const request = new (IS_GO_FOUNDATION ? GoRequest : Request)({
  baseUrl: IS_GO_FOUNDATION ? '' : config.apiBaseUrl,
  tokenKey: TOKEN_KEY,
  refreshTokenKey: REFRESH_TOKEN_KEY,
  refreshPath: authContract.refresh.fullPath,
  loginUrl: () => `${import.meta.env.BASE_URL.replace(/\/$/, '') || ''}/login`,
  onUnauthorized: () => globalThis.dispatchEvent(new Event(ADMIN_AUTH_INVALIDATED_EVENT)),
  unauthorizedFallbackMessage: '密码错误',
  handleMaintenance: true,
  // 同一份后台产物既跑浏览器也被 Electron 承载：按预加载桥接判定终端类型，供会话展示与按终端并发限制
  clientKind: () => (globalThis.window?.electronAPI?.isElectron ? 'desktop' : 'web'),
});
