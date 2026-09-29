import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import * as z from 'zod';
import { positionContract } from '../packages/shared/src/identity/contracts/positions';
import { menuContract } from '../packages/shared/src/identity/contracts/menus';
import { fileContract } from '../packages/shared/src/platform/contracts/files';
import { loginLogContract } from '../packages/shared/src/identity/contracts/login-logs';
import { departmentContract } from '../packages/shared/src/identity/contracts/departments';
import { roleContract } from '../packages/shared/src/identity/contracts/roles';
import { dictContract } from '../packages/shared/src/platform/contracts/dicts';
import { operationLogContract } from '../packages/shared/src/platform/contracts/operation-logs';
import { tenantContract } from '../packages/shared/src/identity/contracts/tenants';
import type { AnyOperation } from '../packages/shared/src/core/contract';

// The foundation catalog grows one verified domain at a time. An operation
// enters this list only after its Go handler and shared schema agree.
const selected: readonly [string, AnyOperation][] = [
  ['positionsAll', positionContract.all],
  ['positionsList', positionContract.list],
  ['positionsExportCsv', positionContract.exportCsv],
  ['loginLogsExportCsv', loginLogContract.exportCsv],
  ['departmentsExportCsv', departmentContract.exportCsv],
  ['rolesExportCsv', roleContract.exportCsv],
  ['dictsExportCsv', dictContract.exportCsv],
  ['tenantsExportCsv', tenantContract.exportCsv],
  ['operationLogsExportCsv', operationLogContract.exportCsv],
  ['positionsDetail', positionContract.detail],
  ['positionsCreate', positionContract.create],
  ['positionsUpdate', positionContract.update],
  ['positionsRemove', positionContract.remove],
  ['menusTree', menuContract.tree],
  ['menusFlat', menuContract.flat],
  ['menusDetail', menuContract.detail],
  ['menusCreate', menuContract.create],
  ['menusUpdate', menuContract.update],
  ['menusRemove', menuContract.remove],
  ['filesRemoveBatch', fileContract.removeBatch],
  ['filesBatchDownload', fileContract.batchDownload],
];

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

const catalog = selected.map(([id, operation]) => {
  const access = operation.access;
  if (!access || access === 'authenticated') throw new Error(`${id}: expected a permission or platform-only access in the shared contract`);
  const permission = 'permission' in access && typeof access.permission === 'string'
    ? access.permission
    : access.platformOnly === true ? 'platform' : null;
  if (!permission) throw new Error(`${id}: expected a permission or platform-only access in the shared contract`);
  const path = operation.fullPath.replace(/^\/api\//, '/api/v1/');
  if (!path.startsWith('/api/v1/')) throw new Error(`${id}: invalid foundation path`);
  const write = !['get', 'head', 'options'].includes(operation.method);
  const request: Record<string, unknown> = {};
  if (operation.params) request.params = operation.params;
  if (operation.query) request.query = operation.query;
  if (operation.body) request.body = { required: true, content: { 'application/json': { schema: operation.body } } };
  const binaryContentType = operation.kind === 'csv' ? 'text/csv' : 'application/zip';
  const success = operation.kind === 'file' || operation.kind === 'csv' ? 200 : operation.method === 'post' ? 201 : 200;
  const successResponse = operation.kind === 'file' || operation.kind === 'csv'
    ? { description: '文件下载', content: { [binaryContentType]: { schema: z.string().meta({ format: 'binary' }) } } }
    : { description: '成功', content: { 'application/json': { schema: z.object({ code: z.literal(0), message: z.string(), data: operation.response }) } } };
  registry.registerPath({
    method: operation.method,
    path,
    operationId: id,
    summary: operation.summary,
    tags: operation.tags,
    security: [{ SessionCookie: [], ...(write ? { CsrfToken: [] } : {}) }],
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
    id, method: operation.method.toUpperCase(), path, permission,
    platformOnly: access.platformOnly === 'multi-tenant',
    audit: operation.audit ? { module: operation.audit.module ?? '岗位管理', ...operation.audit } : null,
  };
});

const document = new OpenApiGeneratorV3(registry.definitions, { sortComponents: 'alphabetically' }).generateDocument({
  openapi: '3.0.3',
  info: { title: 'Zenith Go foundation verified operations', version: '0.1.0' },
});

const generated = new Map<string, string>([
  ['backend/internal/contracts/openapi.json', `${JSON.stringify(document, null, 2)}\n`],
  ['backend/internal/contracts/catalog.json', `${JSON.stringify({ operations: catalog }, null, 2)}\n`],
  ['backend/internal/contracts/catalog.gen.go', `// Code generated by scripts/generate-foundation-contracts.ts; DO NOT EDIT.\npackage contracts\n\ntype Operation struct {\n\tMethod string\n\tPath string\n\tPermission string\n\tPlatformOnly bool\n\tAuditModule string\n\tAuditDescription string\n}\n\nvar Operations = map[string]Operation{\n${catalog.map((item) => `\t${JSON.stringify(item.id)}: {Method: ${JSON.stringify(item.method)}, Path: ${JSON.stringify(item.path)}, Permission: ${JSON.stringify(item.permission)}, PlatformOnly: ${item.platformOnly}, AuditModule: ${JSON.stringify(item.audit?.module ?? '')}, AuditDescription: ${JSON.stringify(item.audit?.description ?? '')}},`).join('\n')}\n}\n`],
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
