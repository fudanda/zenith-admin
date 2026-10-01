import * as z from 'zod';
import { defineContract, op, multipart, fileField, type AnyOperation } from './core/contract';
import { userListQuery } from './identity/contracts/users';
import { loginLogListQuery } from './identity/contracts/login-logs';
import { operationLogListQuery } from './platform/contracts/operation-logs';
import { fileContract, managedFileSchema } from './platform/contracts/files';
const exportEntities = ['system.users', 'system.departments', 'system.positions', 'system.roles', 'system.dicts', 'system.login-logs', 'system.operation-logs', 'system.file-storage-configs'] as const;
export const importRowSchema = z.object({ row: z.int().min(2), label: z.string(), status: z.enum(['success', 'failed', 'skipped']), message: z.string() });
export const syncImportResultSchema = z.object({ dryRun: z.boolean(), total: z.int(), success: z.int(), failed: z.int(), skipped: z.int(), rows: z.array(importRowSchema) });
export type SyncImportResult = z.infer<typeof syncImportResultSchema>;
export const foundationTransferContract = defineContract('/api/v1/foundation', {
 export: op.get('/exports/{entity}', { access: 'authenticated', params: z.object({ entity: z.enum(exportEntities) }), query: z.object({ ...userListQuery.shape, ...loginLogListQuery.shape, ...operationLogListQuery.shape, status: z.string().optional(), sort: z.string().optional(), format: z.enum(['csv','xlsx']) }), kind: 'file', summary: '同步导出基础数据；服务端按实体权限和筛选执行' }),
 template: op.get('/imports/users/template', { access: { permission: 'system:user:import' }, kind: 'file', summary: '下载原用户 XLSX 模板' }),
 users: op.post('/imports/users', { access: { permission: 'system:user:import' }, body: multipart(z.object({ file: fileField(), dryRun: z.enum(['true','false']), duplicate: z.enum(['error','skip','update']) })), response: syncImportResultSchema, audit: { module:'用户管理', description:'同步导入用户', recordBody:false }, summary:'同步 XLSX 导入、预检及逐行结果' }),
});

export const foundationFileContract = defineContract('/api/v1/files', {
 privateContent: op.get('/{id}/private-content', { access:'authenticated', params:z.object({id:z.uuid()}), query:z.object({download:z.enum(['1']).optional()}), kind:'file', summary:'授权访问私有文件字节' }),
});

export const foundationProfileContract=defineContract('/api/v1/auth',{
 avatar:op.post('/avatar',{access:'authenticated',body:multipart(z.object({file:fileField()})),response:managedFileSchema,audit:{module:'个人中心',description:'上传个人头像',recordBody:false},summary:'上传当前账号的 JPEG 或 PNG 头像'}),
});

/** Binary response media types are part of the shared foundation contract. */
export function foundationResponseContentTypes(operation: AnyOperation): readonly string[] {
  if (operation.kind === 'csv') return ['text/csv'];
  const xlsx = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (operation === foundationTransferContract.export) return ['text/csv', xlsx];
  if (operation === foundationTransferContract.template) return [xlsx];
  if (operation === fileContract.content || operation === foundationFileContract.privateContent) return ['*/*'];
  return ['application/zip'];
}
