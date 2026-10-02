import { OpenAPIHono } from '@hono/zod-openapi';
import { developerAppContract } from '@arcbase/shared/open-platform';
import { setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { validationHook, okBody } from '../../lib/openapi-schemas';
import {
  createMyOAuth2Client,
  deleteMyOAuth2Client,
  getMyOAuth2Client,
  getMyOAuth2ClientQuotaUsage,
  listMyOAuth2Clients,
  regenerateMyOAuth2ClientSecret,
  submitMyOAuth2ClientForReview,
  updateMyOAuth2Client,
} from '../../services/open-platform/developer-apps.service';
import { executeOpenApiDebugRequest } from '../../services/open-platform/open-api-debug.service';
import { OPEN_GATEWAY_ENDPOINTS } from './open-gateway';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

const create = defineContractRoute(developerAppContract.create, {
  handler: async (c) => {
    const result = await createMyOAuth2Client(c.req.valid('json'));
    setAuditAfterData(c, { ...result, clientSecret: result.clientSecret ? '[REDACTED]' : '' });
    return c.json(okBody(result, '应用已保存为草稿，请保存密钥后提交审核'), 200);
  },
});
const update = defineContractRoute(developerAppContract.update, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMyOAuth2Client(id));
    const result = await updateMyOAuth2Client(id, c.req.valid('json'));
    setAuditAfterData(c, result);
    return c.json(okBody(result, '更新成功，应用已回到草稿状态'), 200);
  },
});

const remove = defineContractRoute(developerAppContract.remove, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMyOAuth2Client(id));
    await deleteMyOAuth2Client(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const regenerate = defineContractRoute(developerAppContract.regenerateSecret, {
  handler: async (c) => {
    const result = await regenerateMyOAuth2ClientSecret(c.req.valid('param').id);
    setAuditAfterData(c, {
      clientId: result.clientId,
      clientSecret: '[REDACTED]',
      previousValidUntil: result.previousValidUntil,
    });
    return c.json(okBody(result, '密钥轮换成功'), 200);
  },
});

const submit = defineContractRoute(developerAppContract.submit, {
  handler: async (c) => c.json(okBody(await submitMyOAuth2ClientForReview(c.req.valid('param').id), '已提交审核'), 200),
});

const quotaUsage = defineContractRoute(developerAppContract.quotaUsage, {
  handler: async (c) => c.json(okBody(await getMyOAuth2ClientQuotaUsage(c.req.valid('param').id)), 200),
});

const endpointCatalog = defineContractRoute(developerAppContract.debugEndpoints, {
  handler: (c) => c.json(okBody(OPEN_GATEWAY_ENDPOINTS), 200),
});

const debugRequest = defineContractRoute(developerAppContract.debug, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await executeOpenApiDebugRequest(id, c.req.valid('json'))), 200);
  },
});

mountCrud(router, developerAppContract,
  { list: listMyOAuth2Clients, get: getMyOAuth2Client },
  { exclude: ['create', 'update', 'remove'] },
  [create, submit, regenerate, quotaUsage, endpointCatalog, debugRequest, update, remove],
);

export default router;
