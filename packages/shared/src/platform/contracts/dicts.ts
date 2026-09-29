import * as z from 'zod';
import { auditFieldsSchema, dateRangeBound, entityStatusQuery, entityStatusSchema, idParam, keywordQuery, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { lazyRecursive } from '../../core/validation';
import type { EntityStatus } from '../../core/types';
import { createDictItemSchema, createDictSchema, updateDictItemSchema, updateDictSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const dictSchema = z.object({
  id: z.int(),
  name: z.string().meta({ example: '用户状态' }),
  code: z.string().meta({ example: 'user_status' }),
  description: z.string().nullable(),
  status: entityStatusSchema,
  tenantId: z.int().nullable().optional(),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'Dict' });

export type Dict = z.infer<typeof dictSchema>;

/** 字典项；服务端返回平铺列表，`children` 供前端按 parentId 组装树形展示 */
export interface DictItem {
  id: number;
  dictId: number;
  parentId?: number | null;
  label: string;
  value: string;
  color?: string | null;
  sort: number;
  status: EntityStatus;
  remark?: string | null;
  metadata?: Record<string, unknown> | null;
  createdBy?: number | null;
  updatedBy?: number | null;
  createdAt: string;
  updatedAt: string;
  children?: DictItem[];
}

export const dictItemSchema: z.ZodType<DictItem> = lazyRecursive(() => z.object({
  id: z.int(),
  dictId: z.int(),
  parentId: z.int().nullable().optional(),
  label: z.string().meta({ example: '启用' }),
  value: z.string().meta({ example: 'enabled' }),
  color: z.string().nullable().optional(),
  sort: z.int(),
  status: entityStatusSchema,
  remark: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  children: z.array(dictItemSchema).optional(),
})).meta({ id: 'DictItem' });

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const dictListQuery = paginationQuery.extend({
  keyword: keywordQuery('字典名称 / 编码'),
  status: entityStatusQuery,
  startDate: dateRangeBound('创建时间起'),
  endDate: dateRangeBound('创建时间止', 'end'),
});

export const dictCodeParam = z.object({
  code: z.string().meta({ description: '字典编码', example: 'sys_status' }),
});

export const dictItemParam = idParam.extend({
  itemId: z.coerce.number().int().positive().meta({ description: '字典项 ID', example: 1 }),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const dictContract = defineContract('/api/dicts', {
  list: op.get('/', { access: { permission: 'system:dict:list' }, query: dictListQuery, response: paginated(dictSchema), summary: '字典列表' }),
  exportCsv: op.get('/export', { access: { permission: 'system:dict:list' }, query: dictListQuery, kind: 'csv', summary: '按字典列表筛选导出 CSV' }),
  detail: op.get('/{id}', { access: { permission: 'system:dict:list' }, params: idParam, response: dictSchema, summary: '字典详情' }),
  create: op.post('/', { access: { permission: 'system:dict:create' }, audit: '创建字典', body: createDictSchema, response: dictSchema, summary: '创建字典' }),
  update: op.put('/{id}', { access: { permission: 'system:dict:update' }, audit: '更新字典', params: idParam, body: updateDictSchema, response: dictSchema, summary: '更新字典' }),
  remove: op.delete('/{id}', { access: { permission: 'system:dict:delete' }, audit: '删除字典', params: idParam, summary: '删除字典' }),
  items: op.get('/{id}/items', { access: { permission: 'system:dict:list' }, params: idParam, response: z.array(dictItemSchema), summary: '获取字典下所有字典项' }),
  itemsByCode: op.get('/code/{code}/items', { access: 'authenticated', params: dictCodeParam, response: z.array(dictItemSchema), summary: '通过字典编码获取字典项（供前端使用）' }),
  itemDetail: op.get('/{id}/items/{itemId}', { access: { permission: 'system:dict:item' }, params: dictItemParam, response: dictItemSchema, summary: '获取字典项详情' }),
  createItem: op.post('/{id}/items', { access: { permission: 'system:dict:item' }, audit: '创建字典项', params: idParam, body: createDictItemSchema, response: dictItemSchema, summary: '创建字典项' }),
  updateItem: op.put('/{id}/items/{itemId}', { access: { permission: 'system:dict:item' }, audit: '更新字典项', params: dictItemParam, body: updateDictItemSchema, response: dictItemSchema, summary: '更新字典项' }),
  removeItem: op.delete('/{id}/items/{itemId}', { access: { permission: 'system:dict:item' }, audit: '删除字典项', params: dictItemParam, summary: '删除字典项' }),
}, { auditModule: '字典管理', tags: ['Dicts'] });
