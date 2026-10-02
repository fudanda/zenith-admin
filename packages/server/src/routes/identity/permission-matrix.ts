import { OpenAPIHono } from '@hono/zod-openapi';
import { permissionMatrixContract } from '@arcbase/shared/identity';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { getUserPermissionSet, listRolePermissionSets } from '../../services/identity/permission-matrix.service';

// 接口目录（apiCatalogContract，独立资源根）见 ./api-catalog.ts；这里只提供主体（角色 / 用户）持有的权限码
const permissionMatrixRouter = new OpenAPIHono({ defaultHook: validationHook });

const rolesRoute = defineContractRoute(permissionMatrixContract.roles, {
  handler: async (c) => c.json(okBody(await listRolePermissionSets()), 200),
});

const userRoute = defineContractRoute(permissionMatrixContract.user, {
  handler: async (c) => c.json(okBody(await getUserPermissionSet(c.req.valid('param').id)), 200),
});

permissionMatrixRouter.openapiRoutes([rolesRoute, userRoute] as const);

export default permissionMatrixRouter;
