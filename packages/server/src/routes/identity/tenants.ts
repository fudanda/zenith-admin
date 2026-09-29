import { OpenAPIHono } from '@hono/zod-openapi';
import { tenantContract } from '@zenith/shared/identity';
import { setAuditAfterData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { validationHook, okBody, csvStreamBody } from '../../lib/openapi-schemas';
import { streamToCsv } from '../../lib/excel-export';
import {
  listTenants,
  listAllTenants,
  getTenant,
  getTenantStats,
  createTenant,
  updateTenant,
  deleteTenant,
} from '../../services/identity/tenants.service';
import { mountCrud } from '../_crud';

const tenantsRoute = new OpenAPIHono({ defaultHook: validationHook });

const allRoute = defineContractRoute(tenantContract.all, {
  handler: async (c) => c.json(okBody(await listAllTenants()), 200),
});

const exportCsvRoute = defineContractRoute(tenantContract.exportCsv, {
  handler: async (c) => {
    const filters = c.req.valid('query');
    async function* rows() {
      for (let page = 1; ; page++) {
        const result = await listTenants({ ...filters, page, pageSize: 200 });
        for (const row of result.list) yield row;
        if (result.list.length < 200) break;
      }
    }
    const safe = (value: unknown) => {
      const text = String(value ?? '');
      return /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
    };
    return csvStreamBody(c, streamToCsv([
      { key: 'id', header: 'ID' },
      { key: 'name', header: '租户名称', transform: safe },
      { key: 'code', header: '租户编码', transform: safe },
      { key: 'contactName', header: '联系人', transform: safe },
      { key: 'contactPhone', header: '联系电话', transform: value => value ? '***' : '' },
      { key: 'status', header: '状态' },
      { key: 'expireAt', header: '到期时间' },
      { key: 'maxUsers', header: '最大用户数' },
      { key: 'createdAt', header: '创建时间' },
    ], rows()), 'tenants.csv');
  },
});

const statsRoute = defineContractRoute(tenantContract.stats, {
  handler: async (c) => c.json(okBody(await getTenantStats(c.req.valid('param').id)), 200),
});

const createRouteDef = defineContractRoute(tenantContract.create, {
  // 契约审计 recordResponseBody: false — 创建响应可能含初始管理员一次性密码，不落审计日志
  handler: async (c) => {
    const created = await createTenant(c.req.valid('json'));
    // 审计快照剔除初始密码
    const { initialAdmin, ...tenantOnly } = created;
    setAuditAfterData(c, initialAdmin ? { ...tenantOnly, initialAdmin: { username: initialAdmin.username, email: initialAdmin.email } } : tenantOnly);
    return c.json(okBody(created, '创建成功'), 200);
  },
});

mountCrud(tenantsRoute, tenantContract,
  { list: listTenants, get: getTenant, update: updateTenant, remove: deleteTenant },
  {
    exclude: ['create'],
  },
  [allRoute, exportCsvRoute, statsRoute, createRouteDef],
);

export default tenantsRoute;
