import { OpenAPIHono } from '@hono/zod-openapi';
import { roleContract } from '@arcbase/shared/identity';
import { setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { validationHook, conflictResponse, okBody, csvStreamBody } from '../../lib/openapi-schemas';
import { streamToCsv } from '../../lib/excel-export';
import { defineScopeMembersRoute } from './_scope-members';
import {
  listAllRoles,
  listRoles,
  getRole,
  createRole,
  updateRole,
  deleteRole,
  assignRoleMenus,
  getRoleUsers,
  assignRoleUsers,
  getRoleBeforeAudit,
} from '../../services/identity/roles.service';
import { mountCrud } from '../_crud';

const memberPreviewRoute = defineScopeMembersRoute({
  op: roleContract.memberPreview,
  scopeType: 'role',
});

const rolesRouter = new OpenAPIHono({ defaultHook: validationHook });

const allRoute = defineContractRoute(roleContract.all, {
  handler: async (c) => c.json(okBody(await listAllRoles()), 200),
});
const exportCsvRoute = defineContractRoute(roleContract.exportCsv, {
  handler: async (c) => {
    const filters = c.req.valid('query');
    async function* rows() {
      for (let page = 1; ; page++) {
        const result = await listRoles({ ...filters, page, pageSize: 200 });
        for (const row of result.list) yield row;
        if (result.list.length < 200) break;
      }
    }
    const safe = (value: unknown) => {
      const text = String(value ?? '');
      return /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
    };
    return csvStreamBody(c, streamToCsv([
      { key: 'id', header: 'ID' }, { key: 'name', header: '角色名称', transform: safe },
      { key: 'code', header: '角色编码', transform: safe }, { key: 'description', header: '描述', transform: safe },
      { key: 'status', header: '状态' }, { key: 'createdAt', header: '创建时间' },
    ], rows()), 'roles.csv');
  },
});
const assignMenusRoute = defineContractRoute(roleContract.assignMenus, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const data = c.req.valid('json');
    const before = await getRoleBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await assignRoleMenus(id, data.menuIds);
    return c.json(okBody(null, '菜单权限已更新'), 200);
  },
});

const getUsersRoute = defineContractRoute(roleContract.users, {
  handler: async (c) => c.json(okBody(await getRoleUsers(c.req.valid('param').id)), 200),
});

const assignUsersRoute = defineContractRoute(roleContract.assignUsers, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const data = c.req.valid('json');
    const before = await getRoleBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await assignRoleUsers(id, data.userIds);
    return c.json(okBody(null, '用户分配已更新'), 200);
  },
});

mountCrud(rolesRouter, roleContract,
  { list: listRoles, get: getRole, create: createRole, update: updateRole, remove: deleteRole },
  { responses: { remove: conflictResponse } },
  [allRoute, exportCsvRoute, assignMenusRoute, getUsersRoute, assignUsersRoute, memberPreviewRoute],
);

export default rolesRouter;
