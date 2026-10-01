import * as z from 'zod';
import { defineContract, op } from './core/contract';

export const integrationContract = defineContract('/api/v1', {
  modules: op.get('/modules', { access: 'authenticated', response: z.array(z.object({ id: z.string(), pages: z.array(z.object({ id: z.string(), path: z.string(), permission: z.string() })) })), summary: '当前 Go 宿主模块与页面能力' }),
  keyPermissions: op.get('/api-tokens/permissions', { access: 'authenticated', response: z.array(z.string()), summary: '本人可授予 API Key 的权限' }),
  events: op.get('/events', { access: 'authenticated', kind: 'sse', summary: '权限过滤的数据变更与重查提示' }),
  mcp: op.post('/mcp', { access: 'authenticated', body: z.object({ jsonrpc: z.literal('2.0'), method: z.string(), id: z.union([z.string(), z.number()]).optional(), params: z.record(z.string(), z.unknown()).optional() }), response: z.unknown(), summary: '只读 MCP Streamable HTTP', audit: { description: '只读 MCP 请求', recordBody: false } }),
}, { auditModule: '集成接口', tags: ['Integrations'] });

/** Keys can access resource reads, organization/dictionary writes and files.
 * Identity, grants, security and storage secrets require a Cookie session. */
export function permitsApiKeyOperation(id: string, method: string): boolean {
  if (id === 'integrationEvents' || id === 'integrationMcp') return true;
  if (method === 'GET' || method === 'HEAD') return /^(positions|departments|users|roles|userGroups|dicts|files|loginLogs|operationLogs)/.test(id) && !/^filesActiveConfig/.test(id);
  return /^(positions|departments|dicts|files)/.test(id) && !/^(filesBrowse|filesExport)/.test(id);
}
export function apiKeyScopeFor(id: string, permission: string): string {
  if (permission !== 'authenticated') return permission;
  const scopes: Record<string, string> = { filesPrivateContent: 'system:file:download', filesAccessUrl: 'system:file:download', filesUploadStatus: 'system:file:upload', dictsItemsByCode: 'system:dict:list' };
  return scopes[id] ?? '';
}
