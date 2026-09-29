import type { ApiResponse } from '@zenith/shared/core';
import { goAuthContract, type GoSession } from '@zenith/shared/identity';
import { api, apiRaw, type ApiClient } from '@/lib/contract-query';
import type { RequestOptions } from '@/utils/request';
import { GoTransport, goTransport } from './go-transport';

/** Adapts contract-query to the Go Cookie transport without changing page code. */
export function createGoApiClient(transport: GoTransport): ApiClient {
  const call = async <T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, body?: unknown, options?: RequestOptions): Promise<ApiResponse<T>> => {
    const response = await transport.request<T>(method, url, {
      body,
      signal: options?.signal,
      anonymousWrite: method === 'POST' && url === goAuthContract.login.fullPath,
    });
    if (response.code === 0 && (url === goAuthContract.login.fullPath || url === goAuthContract.me.fullPath)) {
      const session = response.data as GoSession;
      transport.setCsrfToken(session.csrfToken);
    }
    if (response.code === 0 && url === goAuthContract.logout.fullPath) transport.clearSession();
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

export function getGoCaptcha() {
  return api(goAuthContract.captcha, { client: goApiClient, silent: true });
}

export function loginGo(input: {
  username: string;
  password: string;
  tenantCode?: string;
  captchaId: string;
  captchaAnswer: string;
}) {
  return apiRaw(goAuthContract.login, { body: input }, { client: goApiClient, silent: true });
}

export function restoreGoSession() {
  return apiRaw(goAuthContract.me, { client: goApiClient, silent: true });
}

export function logoutGo() {
  return apiRaw(goAuthContract.logout, { client: goApiClient, silent: true });
}
