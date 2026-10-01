import { OpenAPIHono } from '@hono/zod-openapi';
import { userContract } from '@zenith/shared/identity';
import { setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { validationHook, okBody, csvStreamBody } from '../../lib/openapi-schemas';
import { streamToCsv } from '../../lib/excel-export';
import {
  listAlertRecipientUsers,
  listAllUsers,
  listUsers,
  createUser,
  batchDeleteUsers,
  batchUpdateUserStatus,
  batchResetUsersPassword,
  updateUser,
  deleteUser,
  updateUserPassword,
  unlockUserById,
  getUserBeforeAudit,
  getUsersBeforeAudit,
  getUser,
  getUserMenuPermissions,
  assignUserMenus,
  getUserDataPermission,
  updateUserDataPermission,
  getUserEffectivePermissions,
  assignRolesToUser,
  getUserRoleAssignmentAudit,
  getUserMenuPermissionsBeforeAudit,
  getUserDataPermissionBeforeAudit,
} from '../../services/identity/users.service';
import { mountCrud } from '../_crud';

const usersRouter = new OpenAPIHono({ defaultHook: validationHook });

const getAllUsersRoute = defineContractRoute(userContract.all, {
  handler: async (c) => c.json(okBody(await listAllUsers()), 200),
});

const exportCsvRoute = defineContractRoute(userContract.exportCsv, {
  handler: async (c) => {
    const filters = c.req.valid('query');
    async function* rows() {
      for (let page = 1; ; page++) {
        const result = await listUsers({ ...filters, page, pageSize: 200 });
        for (const row of result.list) yield {
          ...row,
          email: row.email ? '***' : '',
          phone: row.phone ? '***' : '',
          rolesText: row.roles?.map(role => role.name).join(', ') ?? '',
          positionsText: row.positions?.map(position => position.name).join(', ') ?? '',
        };
        if (result.list.length < 200) break;
      }
    }
    const safe = (value: unknown) => {
      const text = String(value ?? '');
      return /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
    };
    return csvStreamBody(c, streamToCsv([
      { key: 'id', header: 'ID' }, { key: 'username', header: '用户名', transform: safe },
      { key: 'nickname', header: '昵称', transform: safe }, { key: 'departmentName', header: '部门', transform: safe },
      { key: 'status', header: '状态' }, { key: 'email', header: '邮箱' }, { key: 'phone', header: '手机号' },
      { key: 'rolesText', header: '角色', transform: safe }, { key: 'positionsText', header: '岗位', transform: safe },
      { key: 'lastLoginAt', header: '最后登录时间' }, { key: 'createdAt', header: '创建时间' }, { key: 'updatedAt', header: '更新时间' },
    ], rows()), 'users.csv');
  },
});

const getAlertRecipientUsersRoute = defineContractRoute(userContract.alertRecipients, {
  handler: async (c) => c.json(okBody(await listAlertRecipientUsers()), 200),
});
const batchDeleteUsersRoute = defineContractRoute(userContract.removeBatch, {
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const before = await getUsersBeforeAudit(ids);
    if (before.length > 0) setAuditBeforeData(c, before);
    const count = await batchDeleteUsers(ids);
    return c.json(okBody(null, `已删除 ${count} 个用户`), 200);
  },
});

const batchResetPasswordRoute = defineContractRoute(userContract.batchResetPassword, {
  handler: async (c) => {
    const { ids, password } = c.req.valid('json');
    await batchResetUsersPassword(ids, password);
    return c.json(okBody(null, '密码重置成功'), 200);
  },
});

const batchStatusUsersRoute = defineContractRoute(userContract.batchStatus, {
  handler: async (c) => {
    const { ids, status } = c.req.valid('json');
    const before = await getUsersBeforeAudit(ids);
    if (before.length > 0) setAuditBeforeData(c, before);
    await batchUpdateUserStatus(ids, status);
    return c.json(okBody(null, '状态已更新'), 200);
  },
});

const updateUserPasswordRoute = defineContractRoute(userContract.resetPassword, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { password } = c.req.valid('json');
    const before = await getUserBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await updateUserPassword(id, password);
    return c.json(okBody(null, '密码修改成功'), 200);
  },
});

const unlockUserRoute = defineContractRoute(userContract.unlock, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getUserBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await unlockUserById(id);
    return c.json(okBody(null, '解锁成功'), 200);
  },
});
const assignUserRolesRoute = defineContractRoute(userContract.assignRoles, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { roleIds } = c.req.valid('json');
    const before = await getUserRoleAssignmentAudit(id);
    if (before) setAuditBeforeData(c, before);
    await assignRolesToUser(id, roleIds);
    const after = await getUserRoleAssignmentAudit(id);
    if (after) setAuditAfterData(c, after);
    return c.json(okBody(null, '保存成功'), 200);
  },
});

const getUserMenusRoute = defineContractRoute(userContract.menus, {
  handler: async (c) => c.json(okBody(await getUserMenuPermissions(c.req.valid('param').id)), 200),
});

const assignUserMenusRoute = defineContractRoute(userContract.assignMenus, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { menuIds } = c.req.valid('json');
    const before = await getUserMenuPermissionsBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await assignUserMenus(id, menuIds);
    const after = await getUserMenuPermissionsBeforeAudit(id);
    if (after) setAuditAfterData(c, after);
    return c.json(okBody(null, '保存成功'), 200);
  },
});

const getUserDataPermissionRoute = defineContractRoute(userContract.dataPermission, {
  handler: async (c) => c.json(okBody(await getUserDataPermission(c.req.valid('param').id)), 200),
});

const updateUserDataPermissionRoute = defineContractRoute(userContract.updateDataPermission, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const data = c.req.valid('json');
    const before = await getUserDataPermissionBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await updateUserDataPermission(id, data);
    const after = await getUserDataPermissionBeforeAudit(id);
    if (after) setAuditAfterData(c, after);
    return c.json(okBody(null, '保存成功'), 200);
  },
});

const getUserEffectivePermissionsRoute = defineContractRoute(userContract.effectivePermissions, {
  handler: async (c) => c.json(okBody(await getUserEffectivePermissions(c.req.valid('param').id)), 200),
});

mountCrud(usersRouter, userContract,
  { list: listUsers, get: getUser, create: createUser, update: updateUser, remove: deleteUser },
  { exclude: ['removeBatch'] },
  [
    getAlertRecipientUsersRoute,
    getAllUsersRoute,
    exportCsvRoute,
    batchDeleteUsersRoute,
    batchStatusUsersRoute,
    batchResetPasswordRoute,
    updateUserPasswordRoute,
    unlockUserRoute,
    getUserMenusRoute,
    assignUserMenusRoute,
    assignUserRolesRoute,
    getUserDataPermissionRoute,
    updateUserDataPermissionRoute,
    getUserEffectivePermissionsRoute,
  ],
);

export default usersRouter;
