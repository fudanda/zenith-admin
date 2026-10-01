import type { AnyOperation } from '@zenith/shared/core';
import { foundationOperations } from '@zenith/shared/foundation-operations';

const paths = new Map(foundationOperations.map(([, op]) => [op.fullPath, op.fullPath.replace(/^\/api\/(?!v1\/)/, '/api/v1/')]));

export function isFoundationOperation(op: AnyOperation): boolean {
  return paths.has(op.fullPath);
}

/** Reuses Zenith contracts; the HTTP boundary publishes only /api/v1 paths. */
export function foundationPath(op: AnyOperation): string {
  const path = paths.get(op.fullPath);
  if (!path) throw new Error(`操作 ${op.basePath}:${op.name} 尚未接入 Go`);
  return path;
}

/** Original edit forms may carry entity metadata. Send the shared writable
 * schema while preserving omitted fields on partial updates and multipart. */
export function foundationRequestBody(op: AnyOperation, body: unknown): unknown {
  if (!op.body || body === undefined || (typeof FormData !== 'undefined' && body instanceof FormData)) return body;
  const parsed: unknown = op.body.parse(body);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return parsed;
  const partial = op.method === 'put' || op.method === 'patch';
  const supplied = body && typeof body === 'object' ? body : {};
  const removed = new Set(['tenantId', 'tenantCode', 'tenantViewId', 'viewingTenantId']);
  return Object.fromEntries(Object.entries(parsed).filter(([key]) => !removed.has(key) && (!partial || Object.hasOwn(supplied, key))));
}
