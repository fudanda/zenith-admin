import { randomUUID } from 'node:crypto';
import { HTTPException } from 'hono/http-exception';
import { OPEN_SIGNATURE_HEADERS } from '@arcbase/shared/open-platform';
import type { OpenApiDebugResult } from '@arcbase/shared/open-platform';
import { config } from '../../config';
import { httpRequest } from '../../lib/http-client';
import { signRequest } from '../../lib/open-signature';
import { getMyOAuth2Client } from './developer-apps.service';
import { getAppSigningSecret } from './oauth2-clients.service';
import { OPEN_GATEWAY_ENDPOINTS } from '../../routes/open-platform/open-gateway';
import { issueDebugAccessToken } from './oauth2-auth.service';

/** 把目录里的路径模板（/api/open/v1/cms/contents/{id}）与实际路径做匹配 */
function findEndpoint(path: string, method: string): { path: string; method: string } | null {
  const normalizedMethod = method.toUpperCase();
  return OPEN_GATEWAY_ENDPOINTS.find((item) => {
    if (item.method !== normalizedMethod) return false;
    if (item.path === path) return true;
    // 路径参数按单段通配匹配
    const pattern = new RegExp(`^${item.path.replace(/\{[^}]+\}/g, '[^/]+')}$`);
    return pattern.test(path);
  }) ?? null;
}

export async function executeOpenApiDebugRequest(
  appId: number,
  input: {
    method: string;
    path: string;
    query?: Record<string, string>;
    body?: unknown;
  },
): Promise<OpenApiDebugResult> {
  const app = await getMyOAuth2Client(appId);
  const method = input.method.toUpperCase();
  if (!findEndpoint(input.path, method)) {
    throw new HTTPException(400, { message: '不支持的调试端点或请求方法' });
  }

  const url = new URL(input.path, config.openPlatform.internalBaseUrl);
  for (const [key, value] of Object.entries(input.query ?? {})) {
    url.searchParams.append(key, value);
  }

  const rawBody = method === 'GET' || method === 'DELETE' ? '' : JSON.stringify(input.body ?? {});
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = randomUUID();
  const headers: Record<string, string> = { Accept: 'application/json' };
  let stringToSign: string | undefined;

  // 鉴权通道与网关保持一致：开启签名通道的应用走 AppKey + HMAC，
  // 其余应用签发一枚短期调试令牌走 Bearer——否则调试台会被网关以「未开启签名通道」拒绝。
  const secret = app.signEnabled ? await getAppSigningSecret(app.clientId) : null;
  if (app.signEnabled && secret) {
    const signed = signRequest(secret, {
      method,
      path: url.pathname,
      query: url.search,
      timestamp,
      nonce,
      body: rawBody,
    });
    stringToSign = signed.stringToSign;
    headers[OPEN_SIGNATURE_HEADERS.appKey] = app.clientId;
    headers[OPEN_SIGNATURE_HEADERS.timestamp] = timestamp;
    headers[OPEN_SIGNATURE_HEADERS.nonce] = nonce;
    headers[OPEN_SIGNATURE_HEADERS.signature] = signed.signature;
  } else {
    const token = await issueDebugAccessToken(app.clientId);
    headers.Authorization = `Bearer ${token}`;
  }
  if (rawBody) headers['Content-Type'] = 'application/json';

  const startedAt = Date.now();
  const response = await httpRequest(url.toString(), {
    method,
    headers,
    body: rawBody || undefined,
    timeout: 15_000,
    retries: 0,
    ssrfProtection: false,
    circuitBreaker: false,
    httpLog: { level: 'off' },
  });
  const responseBody = (await response.text()).slice(0, 64 * 1024);
  const responseHeaders: Record<string, string> = {};
  for (const key of ['content-type', 'x-request-id', 'x-arcbase-environment', 'retry-after']) {
    const value = response.headers.get(key);
    if (value) responseHeaders[key] = value;
  }

  return {
    requestUrl: url.toString(),
    method,
    requestHeaders: headers,
    stringToSign,
    statusCode: response.status,
    responseHeaders,
    responseBody,
    durationMs: Date.now() - startedAt,
  };
}
