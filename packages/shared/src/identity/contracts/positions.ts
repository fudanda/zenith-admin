import * as z from 'zod';
import { auditFieldsSchema, batchIdsBody, dateRangeQuery, entityStatusQuery, entityStatusSchema, idParam, keywordQuery, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { sensitive } from '../../core/sensitive';
import { createPositionSchema, scopeUserIdsSchema, updatePositionSchema } from '../validation';
import { memberPreviewOp } from './scope-members';
import { userPreviewSchema } from './user-preview';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const positionSchema = z.object({
  id: z.int(),
  name: z.string().meta({ example: '前端工程师' }),
  code: z.string().meta({ example: 'frontend_dev' }),
  sort: z.int().meta({ example: 1 }),
  status: entityStatusSchema,
  remark: z.string().nullable().optional(),
  userCount: z.int().optional().meta({ example: 5, description: '成员数（列表返回）' }),
  userPreview: z.array(userPreviewSchema).optional().meta({ description: '成员摘要（列表返回）' }),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'Position' });

export type Position = z.infer<typeof positionSchema>;

/** 岗位成员（分配成员抽屉的预选来源） */
export const positionMemberSchema = z.object({
  id: z.int(),
  username: z.string(),
  nickname: z.string(),
  email: sensitive(z.string().nullable(), 'email'),
  avatar: z.string().nullable(),
  departmentName: z.string().nullable(),
  joinedAt: z.string(),
}).meta({ id: 'PositionMember' });

export type PositionMember = z.infer<typeof positionMemberSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const positionListQuery = paginationQuery.extend({
  keyword: keywordQuery('名称 / 编码'),
  status: entityStatusQuery,
  ...dateRangeQuery('创建时间'),
});

export const positionContract = defineContract('/api/positions', {
  all: op.get('/all', { access: { permission: 'system:position:list' }, response: z.array(positionSchema), summary: '全量岗位（供下拉框）' }),
  list: op.get('/', { access: { permission: 'system:position:list' }, query: positionListQuery, response: paginated(positionSchema), summary: '岗位列表' }),
  exportCsv: op.get('/export', { access: { permission: 'system:position:list' }, query: positionListQuery, kind: 'csv', summary: '按岗位列表筛选导出 CSV' }),
  detail: op.get('/{id}', { access: { permission: 'system:position:list' }, params: idParam, response: positionSchema, summary: '岗位详情' }),
  create: op.post('/', { access: { permission: 'system:position:create' }, audit: '创建岗位', body: createPositionSchema, response: positionSchema, summary: '创建岗位' }),
  update: op.put('/{id}', { access: { permission: 'system:position:update' }, audit: '更新岗位', params: idParam, body: updatePositionSchema, response: positionSchema, summary: '更新岗位' }),
  removeBatch: op.delete('/batch', { access: { permission: 'system:position:delete' }, audit: '批量删除岗位', body: batchIdsBody, summary: '批量删除岗位' }),
  remove: op.delete('/{id}', { access: { permission: 'system:position:delete' }, audit: '删除岗位', params: idParam, summary: '删除岗位' }),
  members: op.get('/{id}/members', { access: { permission: 'system:position:list' }, params: idParam, response: z.array(positionMemberSchema), summary: '获取岗位成员' }),
  memberPreview: memberPreviewOp('岗位成员分页预览', 'system:position:list'),
  setMembers: op.put('/{id}/members', { access: { permission: 'system:position:update' }, audit: '设置岗位成员', params: idParam, body: scopeUserIdsSchema, summary: '设置岗位成员（全量覆盖）' }),
}, { auditModule: '岗位管理', tags: ['Positions'] });
