import { OpenAPIHono } from '@hono/zod-openapi';
import { departmentContract } from '@zenith/shared/identity';
import { defineContractRoute } from '../../lib/contract-route';
import { validationHook, okBody, csvStreamBody } from '../../lib/openapi-schemas';
import { streamToCsv } from '../../lib/excel-export';
import { defineScopeMembersRoute } from './_scope-members';
import {
  listDepartmentTree,
  listDepartmentsFlat,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  getDepartment,
  matchesDepartmentFilter,
} from '../../services/identity/departments.service';
import { mountCrud } from '../_crud';

const memberPreviewRoute = defineScopeMembersRoute({
  op: departmentContract.memberPreview,
  scopeType: 'department',
});

const departmentsRouter = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineContractRoute(departmentContract.tree, {
  handler: async (c) => c.json(okBody(await listDepartmentTree(c.req.valid('query'))), 200),
});

const flatRoute = defineContractRoute(departmentContract.flat, {
  handler: async (c) => c.json(okBody((await listDepartmentsFlat()).filter(row => matchesDepartmentFilter(row, c.req.valid('query')))), 200),
});

const exportCsvRoute = defineContractRoute(departmentContract.exportCsv, {
  handler: async (c) => {
    const rows = (await listDepartmentsFlat()).filter(row => matchesDepartmentFilter(row, c.req.valid('query')));
    const safe = (value: unknown) => {
      const text = String(value ?? '');
      return /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
    };
    return csvStreamBody(c, streamToCsv([
      { key: 'id', header: 'ID' }, { key: 'name', header: '部门名称', transform: safe },
      { key: 'code', header: '部门编码', transform: safe }, { key: 'category', header: '类别', transform: safe },
      { key: 'leaderName', header: '负责人', transform: safe }, { key: 'phone', header: '电话', transform: safe },
      { key: 'status', header: '状态' }, { key: 'createdAt', header: '创建时间' },
    ], rows), 'departments.csv');
  },
});

mountCrud(departmentsRouter, departmentContract,
  { get: getDepartment, create: createDepartment, update: updateDepartment, remove: deleteDepartment },
  {},
  [listRoute, flatRoute, exportCsvRoute, memberPreviewRoute],
);

export default departmentsRouter;
