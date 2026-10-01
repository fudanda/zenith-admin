import type { ApiResponse } from '@zenith/shared/core';
import { goAuthContract } from '@zenith/shared/identity';
import type { ApiClient } from './contract-query';
import type { RequestOptions } from '@/utils/request';
import { showRequestErrorToast } from '@/utils/request-toast';
import { GO_SESSION_INVALIDATED, GoTransport, goTransport } from './go-transport';
export { GO_SESSION_INVALIDATED } from './go-transport';

export function createGoApiClient(transport: GoTransport): ApiClient {
  const call = async <T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, body?: unknown, options?: RequestOptions): Promise<ApiResponse<T>> => {
    const response = await transport.request<T>(method, url, {
      body, signal: options?.signal, headers: options?.headers,
      anonymousWrite: method === 'POST' && [goAuthContract.login.fullPath,goAuthContract.resolveSessionConflict.fullPath].includes(url),
    });
    if (response.code === 0 && (url === goAuthContract.me.fullPath || [goAuthContract.login.fullPath,goAuthContract.resolveSessionConflict.fullPath].includes(url) && response.data && typeof response.data === 'object' && 'csrfToken' in response.data)) {
      const session = goAuthContract.me.response.parse(response.data);
      transport.setCsrfToken(session.csrfToken);
    }
    if (response.code === 0 && url === goAuthContract.logout.fullPath) transport.clearSession();
    if (response.code === 0 && method === 'PUT' && url === '/api/v1/auth/password') {
      transport.clearSession(); globalThis.dispatchEvent(new Event(GO_SESSION_INVALIDATED));
    }
    if (response.code !== 0 && !options?.silent) showRequestErrorToast(response.message, response.requestId);
    return response;
  };
  return {
    get: <T>(url: string, options?: RequestOptions) => call<T>('GET', url, undefined, options),
    post: <T>(url: string, body?: unknown, options?: RequestOptions) => call<T>('POST', url, body, options),
    put: <T>(url: string, body?: unknown, options?: RequestOptions) => call<T>('PUT', url, body, options),
    patch: <T>(url: string, body?: unknown, options?: RequestOptions) => call<T>('PATCH', url, body, options),
    delete: <T>(url: string, body?: unknown, options?: RequestOptions) => call<T>('DELETE', url, body, options),
  };
}

export const goApiClient = createGoApiClient(goTransport);
