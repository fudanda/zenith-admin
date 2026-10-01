import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import * as z from 'zod';
import { isMultipart } from '../packages/shared/src/core/contract';
import { foundationOperations } from '../packages/shared/src/foundation-operations';
import { foundationResponseContentTypes } from '../packages/shared/src/foundation-transfer';

const registry = new OpenAPIRegistry();
registry.registerComponent('securitySchemes', 'SessionCookie', {
  type: 'apiKey', in: 'cookie', name: 'zenith_session',
  description: '管理员 HttpOnly 服务端会话；浏览器自动发送。',
});
registry.registerComponent('securitySchemes', 'CsrfToken', {
  type: 'apiKey', in: 'header', name: 'X-CSRF-Token',
  description: '写请求使用 /auth/me 或登录响应中的 CSRF token。',
});

const errorSchema = z.object({
  code: z.int(), message: z.string(), data: z.null(), error: z.string(),
}).meta({ id: 'FoundationError' });

const catalog = foundationOperations.map(([id, operation]) => {
  const access = operation.access;
  if (!operation.public && !access) throw new Error(`${id}: expected access in the shared contract`);
  const anyPermissions = access && access !== 'authenticated' && 'permission' in access && Array.isArray(access.permission) ? access.permission : [];
  const permission = operation.public ? '' : access === 'authenticated' ? 'authenticated' : access && 'permission' in access && typeof access.permission === 'string'
    ? access.permission
    : anyPermissions.length ? 'authenticated' : access && access.platformOnly === true ? 'super_admin' : null;
  if (permission === null) throw new Error(`${id}: expected a permission or platform-only access in the shared contract`);
  const path = operation.fullPath.startsWith('/api/v1/') ? operation.fullPath : operation.fullPath.replace(/^\/api\//, '/api/v1/');
  if (!path.startsWith('/api/v1/')) throw new Error(`${id}: invalid foundation path`);
  const write = !['get', 'head', 'options'].includes(operation.method);
  const request: Record<string, unknown> = {};
  if (operation.params) request.params = operation.params;
  if (operation.query) request.query = operation.query;
  if (operation.body) request.body = { required: true, content: { [isMultipart(operation.body) ? 'multipart/form-data' : 'application/json']: { schema: operation.body } } };
  const binaryContent = Object.fromEntries(foundationResponseContentTypes(operation).map((contentType) => [contentType, { schema: z.string().meta({ format: 'binary' }) }]));
  const success = operation.kind === 'file' || operation.kind === 'csv' ? 200 : ['positionsCreate', 'menusCreate'].includes(id) ? 201 : 200;
  const successResponse = operation.kind === 'file' || operation.kind === 'csv'
    ? { description: '文件下载', content: binaryContent }
    : { description: '成功', content: { 'application/json': { schema: z.object({ code: z.literal(0), message: z.string(), data: operation.response }) } } };
  registry.registerPath({
    method: operation.method,
    path,
    operationId: id,
    summary: operation.summary,
    tags: operation.tags,
    security: operation.public ? [] : [{ SessionCookie: [], ...(write ? { CsrfToken: [] } : {}) }],
    ...(Object.keys(request).length ? { request } : {}),
    responses: {
      [success]: successResponse,
      400: { description: '请求无效', content: { 'application/json': { schema: errorSchema } } },
      401: { description: '未登录', content: { 'application/json': { schema: errorSchema } } },
      403: { description: '无权限或 CSRF 校验失败', content: { 'application/json': { schema: errorSchema } } },
      404: { description: '资源不存在', content: { 'application/json': { schema: errorSchema } } },
      409: { description: '版本或唯一性冲突', content: { 'application/json': { schema: errorSchema } } },
      503: { description: '服务暂不可用', content: { 'application/json': { schema: errorSchema } } },
    },
  });
  return {
    id, method: operation.method.toUpperCase(), path, permission, anyPermissions,
    public: operation.public,
    superAdminOnly: access !== 'authenticated' && access?.platformOnly === true,
    audit: operation.audit ? { module: operation.audit.module ?? '岗位管理', ...operation.audit } : null,
  };
});

const document = new OpenApiGeneratorV3(registry.definitions, { sortComponents: 'alphabetically' }).generateDocument({
  openapi: '3.0.3',
  info: { title: 'Zenith Go foundation verified operations', version: '0.1.0' },
});

// Derive the production projection from existing domain schemas. Legacy Hono
// schemas remain available to the retained source, never to the Go wire model.
const removed = new Set(['tenantId', 'tenantName', 'tenantCode', 'tenantViewId', 'viewingTenantId']);
function singleOrganization(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) { value.forEach(singleOrganization); return; }
  const node = value as Record<string, unknown>;
  if (node.properties && typeof node.properties === 'object') {
    for (const key of removed) delete (node.properties as Record<string, unknown>)[key];
  }
  if (Array.isArray(node.required)) node.required = node.required.filter((key) => !removed.has(String(key)));
  if (Array.isArray(node.parameters)) node.parameters = node.parameters.filter((param) => !removed.has(String((param as { name?: string }).name)));
  Object.values(node).forEach(singleOrganization);
}
singleOrganization(document);

const generated = new Map<string, string>([
  ['backend/internal/contracts/openapi.json', `${JSON.stringify(document, null, 2)}\n`],
  ['backend/internal/contracts/catalog.json', `${JSON.stringify({ operations: catalog }, null, 2)}\n`],
  ['backend/internal/contracts/catalog.gen.go', `// Code generated by scripts/generate-foundation-contracts.ts; DO NOT EDIT.\npackage contracts\n\ntype Operation struct {\n\tMethod string\n\tPath string\n\tPermission string\n\tAnyPermissions []string\n\tSuperAdminOnly bool\n\tPublic bool\n\tAuditModule string\n\tAuditDescription string\n}\n\nvar Operations = map[string]Operation{\n${catalog.map((item) => `\t${JSON.stringify(item.id)}: {Method: ${JSON.stringify(item.method)}, Path: ${JSON.stringify(item.path)}, Permission: ${JSON.stringify(item.permission)}, AnyPermissions: []string{${item.anyPermissions.map((p) => JSON.stringify(p)).join(',')}}, SuperAdminOnly: ${item.superAdminOnly}, Public: ${item.public}, AuditModule: ${JSON.stringify(item.audit?.module ?? '')}, AuditDescription: ${JSON.stringify(item.audit?.description ?? '')}},`).join('\n')}\n}\n`],
]);
const goCatalog = 'backend/internal/contracts/catalog.gen.go';
generated.set(goCatalog, execFileSync('gofmt', { input: generated.get(goCatalog), encoding: 'utf8' }));

const check = process.argv.includes('--check');
let drift = false;
for (const [path, content] of generated) {
  const target = resolve(path);
  if (check) {
    try {
      if (readFileSync(target, 'utf8') !== content) drift = true;
    } catch {
      drift = true;
    }
  } else {
    writeFileSync(target, content);
  }
}
if (drift) throw new Error('foundation contract artifacts are stale; run npm run generate:foundation-contracts');
