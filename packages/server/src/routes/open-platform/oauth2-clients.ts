import { OpenAPIHono } from '@hono/zod-openapi';
import { oauth2ClientContract } from '@arcbase/shared/open-platform';
import { setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { validationHook, okBody } from '../../lib/openapi-schemas';
import {
  listOAuth2Clients,
  createOAuth2Client,
  getOAuth2Client,
  updateOAuth2Client,
  deleteOAuth2Client,
  regenerateOAuth2ClientSecret,
  listClientTokens,
  revokeToken,
  getOAuth2ClientBeforeAudit,
  getOAuth2TokenBeforeAudit,
  listAppOptions,
  listClientGrants,
  listMyGrants,
  revokeMyGrant,
  reviewOAuth2Client,
} from '../../services/open-platform/oauth2-clients.service';
import { notifyAppReviewResult } from '../../services/open-platform/developer-apps.service';
import { currentUser } from '../../lib/context';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

const create = defineContractRoute(oauth2ClientContract.create, {
  handler: async (c) => {
    const created = await createOAuth2Client(c.req.valid('json'));
    setAuditAfterData(c, { ...created, clientSecret: created.clientSecret ? '[REDACTED]' : '' });
    return c.json(okBody(created, '应用已创建，client_secret 仅返回一次，请妥善保存'), 200);
  },
});
const grants = defineContractRoute(oauth2ClientContract.grants, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { page, pageSize } = c.req.valid('query');
    const client = await getOAuth2Client(id);
    return c.json(okBody(await listClientGrants(client.clientId, { page, pageSize })), 200);
  },
});

const review = defineContractRoute(oauth2ClientContract.review, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getOAuth2ClientBeforeAudit(id));
    const result = await reviewOAuth2Client(id, c.req.valid('json'));
    await notifyAppReviewResult(id);
    setAuditAfterData(c, result);
    return c.json(okBody(result, '审核完成'), 200);
  },
});

const update = defineContractRoute(oauth2ClientContract.update, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getOAuth2ClientBeforeAudit(id));
    return c.json(okBody(await updateOAuth2Client(id, c.req.valid('json'))), 200);
  },
});
const regenerateSecret = defineContractRoute(oauth2ClientContract.regenerateSecret, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getOAuth2ClientBeforeAudit(id));
    const result = await regenerateOAuth2ClientSecret(id);
    setAuditAfterData(c, { clientId: result.clientId, clientSecret: '[REDACTED]' });
    return c.json(okBody(result, '新 secret 仅返回一次，请妥善保存'), 200);
  },
});

const tokens = defineContractRoute(oauth2ClientContract.tokens, {
  handler: async (c) => {
    const { clientId, page, pageSize } = c.req.valid('query');
    return c.json(okBody(await listClientTokens(clientId, { page, pageSize })), 200);
  },
});

const revokeTokenRoute = defineContractRoute(oauth2ClientContract.revokeToken, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getOAuth2TokenBeforeAudit(id));
    await revokeToken(id);
    return c.json(okBody(null, '令牌已撤销'), 200);
  },
});

const options = defineContractRoute(oauth2ClientContract.options, {
  handler: async (c) => c.json(okBody(await listAppOptions()), 200),
});

/**
 * 「我的已授权应用」——用户自助管理入口，只操作当前登录用户自己的授权，
 * 因此不挂任何 permission guard（登录即可访问自己的数据）。
 */
const myGrants = defineContractRoute(oauth2ClientContract.myGrants, {
  handler: async (c) => {
    const { page, pageSize } = c.req.valid('query');
    return c.json(okBody(await listMyGrants(currentUser().userId, { page, pageSize })), 200);
  },
});

const revokeMyGrantRoute = defineContractRoute(oauth2ClientContract.revokeMyGrant, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await revokeMyGrant(currentUser().userId, id);
    return c.json(okBody(null, '授权已撤销'), 200);
  },
});

mountCrud(router, oauth2ClientContract,
  { list: listOAuth2Clients, get: getOAuth2Client, remove: deleteOAuth2Client },
  {
    exclude: ['create', 'update'],
  },
  [
    options,
    tokens,
    revokeTokenRoute,
    myGrants,
    revokeMyGrantRoute,
    create,
    grants,
    review,
    update,
    regenerateSecret,
  ],
);

export default router;
