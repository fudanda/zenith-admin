import * as z from 'zod';
import { auditFieldsSchema, dateRangeQuery, entityStatusQuery, entityStatusSchema, idParam, keywordQuery, paginated, paginationQuery, queryEnum } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { sensitive } from '../../core/sensitive';
import { DATA_SCOPES } from '../constants';
import { assignRoleMenusSchema, assignRoleUsersSchema, createRoleSchema, updateRoleSchema } from '../validation';
import { memberPreviewOp } from './scope-members';
import { userPreviewSchema } from './user-preview';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const roleSchema = z.object({
  id: z.int().meta({ example: 1 }),
  name: z.string().meta({ example: '超级管理员' }),
  code: z.string().meta({ example: 'super_admin' }),
  description: z.string().nullable().optional(),
  /** 用户携带的角色摘要（登录态 / 用户详情）不含数据范围 */
  dataScope: queryEnum(DATA_SCOPES).meta({ example: 'all' }),
  tenantId: z.int().nullable().optional(),
  status: entityStatusSchema.meta({ example: 'enabled' }),
  ...auditFieldsSchema,
  createdAt: z.string().meta({ example: '2026-01-01 00:00:00' }),
  updatedAt: z.string().meta({ example: '2026-01-01 00:00:00' }),
  menuIds: z.array(z.int()).optional().meta({ description: '已分配菜单 ID（仅详情返回）' }),
  deptScopeIds: z.array(z.int()).optional().meta({ description: '角色管理范围（部门 id 列表），空表示全员' }),
  userCount: z.int().optional().meta({ example: 5, description: '关联用户数（列表返回）' }),
  userPreview: z.array(userPreviewSchema).optional().meta({ description: '成员摘要（列表返回）' }),
}).meta({ id: 'Role' });

export type Role = z.infer<typeof roleSchema>;

/** 角色关联用户（分配用户抽屉的预选来源） */
export const roleUserSchema = z.object({
  id: z.int(),
  username: z.string(),
  nickname: z.string(),
  email: sensitive(z.string().nullable(), 'email'),
  avatar: z.string().nullable(),
  status: entityStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'RoleUser' });

export type RoleUser = z.infer<typeof roleUserSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const roleListQuery = paginationQuery.extend({
  keyword: keywordQuery('名称 / 编码'),
  status: entityStatusQuery,
  ...dateRangeQuery('创建时间'),
});

export const roleContract = defineContract('/api/roles', {
  all: op.get('/all', { access: { permission: 'system:role:list' }, response: z.array(roleSchema), summary: '全量角色（供下拉框）' }),
  list: op.get('/', { access: { permission: 'system:role:list' }, query: roleListQuery, response: paginated(roleSchema), summary: '角色列表' }),
  exportCsv: op.get('/export', { access: { permission: 'system:role:list' }, query: roleListQuery, kind: 'csv', summary: '按角色列表筛选导出 CSV' }),
  detail: op.get('/{id}', { access: { permission: 'system:role:list' }, params: idParam, response: roleSchema, summary: '获取单个角色（含 menuIds）' }),
  create: op.post('/', { access: { permission: 'system:role:create' }, audit: '创建角色', body: createRoleSchema, response: roleSchema, summary: '新增角色' }),
  update: op.put('/{id}', { access: { permission: 'system:role:update' }, audit: '更新角色', params: idParam, body: updateRoleSchema, response: roleSchema, summary: '更新角色' }),
  remove: op.delete('/{id}', { access: { permission: 'system:role:delete' }, audit: '删除角色', params: idParam, summary: '删除角色' }),
  assignMenus: op.put('/{id}/menus', { access: { permission: 'system:role:assign' }, audit: '分配角色菜单', params: idParam, body: assignRoleMenusSchema, summary: '分配角色菜单' }),
  users: op.get('/{id}/users', { access: { permission: 'system:role:list' }, params: idParam, response: z.array(roleUserSchema), summary: '获取角色关联用户' }),
  assignUsers: op.put('/{id}/users', { access: { permission: 'system:role:assign' }, audit: '分配角色用户', params: idParam, body: assignRoleUsersSchema, summary: '分配角色用户' }),
  memberPreview: memberPreviewOp('角色成员分页预览', 'system:role:list'),
}, { auditModule: '角色管理', tags: ['Roles'] });
