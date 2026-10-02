import { fillPath, type AnyOperation, type ApiResponse, type EmptyInput, type InputOf, type OutputOf, type ParamsSchema, type ShapeInput } from '@arcbase/shared/core';
import { foundationOperations } from '@arcbase/shared/foundation-operations';
import { foundationSettingsBody, foundationSettingsOperation } from '@arcbase/shared/settings/foundation';
import type { RequestOptions } from './client';
import { ApiError } from './errors';

export interface JsonClient {
  resolveOperationPath?(op: AnyOperation): string | undefined;
  get<T>(url: string, options?: RequestOptions): Promise<ApiResponse<T>>;
  post<T>(url: string, body?: unknown, options?: RequestOptions): Promise<ApiResponse<T>>;
  put<T>(url: string, body?: unknown, options?: RequestOptions): Promise<ApiResponse<T>>;
  patch<T>(url: string, body?: unknown, options?: RequestOptions): Promise<ApiResponse<T>>;
  delete<T>(url: string, body?: unknown, options?: RequestOptions): Promise<ApiResponse<T>>;
}

const paths = new Map(foundationOperations.map(([, op]) => [op.fullPath, op.fullPath.replace(/^\/api\/(?!v1\/)/, '/api/v1/')]));
export function isFoundationOperation(op: AnyOperation): boolean { return paths.has(op.fullPath); }
export function foundationPath(op: AnyOperation): string {
  const path = paths.get(op.fullPath);
  if (!path) throw new Error(`操作 ${op.basePath}:${op.name} 尚未接入 Go`);
  return path;
}

export function foundationRequestBody(op: AnyOperation, body: unknown): unknown {
  if (!op.body || body === undefined || body instanceof FormData) return body;
  const parsed: unknown = op.body.parse(body);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return parsed;
  const partial = op.method === 'put' || op.method === 'patch';
  const supplied = body && typeof body === 'object' ? body : {};
  const removed = new Set(['tenantId', 'tenantCode', 'tenantViewId', 'viewingTenantId']);
  return Object.fromEntries(Object.entries(parsed).filter(([key]) => !removed.has(key) && (!partial || Object.hasOwn(supplied, key))));
}

export function toQueryString(params: object): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

type LooseInput = { params?: Record<string, unknown>; query?: object; headers?: Record<string, unknown>; body?: unknown };
type InputArgs<Op extends AnyOperation> = Record<never, never> extends InputOf<Op> ? [input?: InputOf<Op>] : [input: InputOf<Op>];
export type UrlInputOf<Op extends AnyOperation> =
  (Op['params'] extends ParamsSchema ? { params: ShapeInput<Op['params']> } : EmptyInput) &
  (Op['query'] extends ParamsSchema ? { query: ShapeInput<Op['query']> } : EmptyInput);
type UrlArgs<Op extends AnyOperation> = Record<never, never> extends UrlInputOf<Op> ? [input?: UrlInputOf<Op>] : [input: UrlInputOf<Op>];

export function operationURL<Op extends AnyOperation>(op: Op, ...args: UrlArgs<Op>): string {
  const values = args[0] as LooseInput | undefined;
  return fillPath(foundationPath(op), values?.params) + (values?.query ? toQueryString(values.query) : '');
}

/** Typed calls reuse shared schemas, including single-organization projections. */
export async function callRaw<Op extends AnyOperation>(client: JsonClient, op: Op, ...args: [...InputArgs<Op>, options?: RequestOptions]): Promise<ApiResponse<OutputOf<Op>>> {
  if (op.kind !== 'json') throw new Error(`契约操作「${op.name}」为 ${op.kind} 响应，请使用文件通道`);
  const input = args[0] as LooseInput | undefined;
  const options = args[1] as RequestOptions | undefined;
  const headers = new Headers(options?.headers);
  for (const [key, value] of Object.entries(input?.headers ?? {})) {
    if (value !== undefined && value !== null) headers.set(key, String(value));
  }
  const requestOptions = { ...options, headers };
  const hostPath = client.resolveOperationPath?.(op);
  const url = hostPath ? fillPath(hostPath, input?.params) + (input?.query ? toQueryString(input.query) : '') : operationURL(op, ...([input] as unknown as UrlArgs<Op>));
  const projected = hostPath ? op : foundationSettingsOperation(op);
  const body = hostPath ? hostRequestBody(op, input?.body) : foundationRequestBody(projected, foundationSettingsBody(op, input?.body));
  const response = op.method === 'get'
    ? await client.get<OutputOf<Op>>(url, requestOptions)
    : await client[op.method]<OutputOf<Op>>(url, body, requestOptions);
  return response.code === 0 ? { ...response, data: projected.response.parse(response.data) as OutputOf<Op> } : response;
}

function hostRequestBody(op: AnyOperation, body: unknown): unknown {
  if (!op.body || body === undefined || body instanceof FormData) return body;
  const parsed: unknown = op.body.parse(body);
  if ((op.method === 'put' || op.method === 'patch') && parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return Object.fromEntries(Object.entries(parsed).filter(([key]) => body && typeof body === 'object' && Object.hasOwn(body, key)));
  }
  return parsed;
}

export async function call<Op extends AnyOperation>(client: JsonClient, op: Op, ...args: [...InputArgs<Op>, options?: RequestOptions]): Promise<OutputOf<Op>> {
  return unwrap(await callRaw(client, op, ...args));
}
export function unwrap<T>(response: ApiResponse<T>): T {
  if (response.code !== 0) throw new ApiError(response.code, response.message);
  return response.data;
}
