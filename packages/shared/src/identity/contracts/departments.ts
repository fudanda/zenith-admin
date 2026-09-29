import * as z from 'zod';
import { auditFieldsSchema, entityStatusSchema, idParam, keywordQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { createDepartmentSchema, updateDepartmentSchema } from '../validation';
import { memberPreviewOp } from './scope-members';
import { userPreviewSchema } from './user-preview';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 部门节点字段（不含子树）；树形响应在此基础上递归挂 children */
export const departmentFieldsSchema = z.object({
  id: z.int(),
  parentId: z.int().meta({ example: 0 }),
  name: z.string().meta({ example: '技术部' }),
  code: z.string(),
  category: z.string().meta({ example: 'department' }),
  leaderId: z.int().nullable().optional(),
  leaderName: z.string().nullable().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  sort: z.int(),
  status: entityStatusSchema,
  userCount: z.int().optional().meta({ example: 5, description: '成员数（部门树返回）' }),
  userPreview: z.array(userPreviewSchema).optional().meta({ description: '成员摘要（部门树返回）' }),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** 递归类型需要显式命名，声明文件才能保留 children 的元素类型 */
export interface Department extends z.infer<typeof departmentFieldsSchema> {
  children?: Department[];
}

export const departmentSchema: z.ZodType<Department> = departmentFieldsSchema
  .extend({
    get children() {
      return z.array(departmentSchema).optional();
    },
  })
  .meta({ id: 'Department' });

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const departmentTreeQuery = z.object({
  keyword: keywordQuery('按名称 / 编码过滤，命中节点保留其祖先链'),
  status: z.string().optional(),
});

export const departmentContract = defineContract('/api/departments', {
  tree: op.get('/', { access: { permission: 'system:department:list' }, query: departmentTreeQuery, response: z.array(departmentSchema), summary: '部门树' }),
  flat: op.get('/flat', { access: { permission: 'system:department:list' }, query: departmentTreeQuery, response: z.array(departmentSchema), summary: '部门扁平列表' }),
  exportCsv: op.get('/export', { access: { permission: 'system:department:list' }, query: departmentTreeQuery, kind: 'csv', summary: '按部门列表筛选导出 CSV' }),
  detail: op.get('/{id}', { access: { permission: 'system:department:list' }, params: idParam, response: departmentSchema, summary: '部门详情' }),
  create: op.post('/', { access: { permission: 'system:department:create' }, audit: '创建部门', body: createDepartmentSchema, response: departmentSchema, summary: '创建部门' }),
  update: op.put('/{id}', { access: { permission: 'system:department:update' }, audit: '更新部门', params: idParam, body: updateDepartmentSchema, response: departmentSchema, summary: '更新部门' }),
  remove: op.delete('/{id}', { access: { permission: 'system:department:delete' }, audit: '删除部门', params: idParam, summary: '删除部门' }),
  memberPreview: memberPreviewOp('部门成员分页预览', 'system:department:list'),
}, { auditModule: '部门管理', tags: ['Departments'] });
