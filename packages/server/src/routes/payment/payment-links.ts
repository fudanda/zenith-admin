import { OpenAPIHono } from '@hono/zod-openapi';
import { paymentLinkContract, type PaymentLink } from '@arcbase/shared/payment';
import { setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { listLinks, getLink, createLink, updateLink, deleteLink, rotateLinkToken } from '../../services/payment/payment-link.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

function maskPaymentLinkForAudit(link: PaymentLink): PaymentLink {
  return { ...link, token: '***' };
}
const createRouteDef = defineContractRoute(paymentLinkContract.create, {
  handler: async (c) => {
    const created = await createLink(c.req.valid('json'));
    setAuditAfterData(c, maskPaymentLinkForAudit(created));
    return c.json(okBody(created, '创建成功'), 200);
  },
});

const updateRoute = defineContractRoute(paymentLinkContract.update, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, maskPaymentLinkForAudit(await getLink(id)));
    const updated = await updateLink(id, c.req.valid('json'));
    setAuditAfterData(c, maskPaymentLinkForAudit(updated));
    return c.json(okBody(updated, '更新成功'), 200);
  },
});
const rotateTokenRoute = defineContractRoute(paymentLinkContract.rotateToken, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, maskPaymentLinkForAudit(await getLink(id)));
    return c.json(okBody(await rotateLinkToken(id), 'token 已重置，旧链接已失效'), 200);
  },
});

mountCrud(router, paymentLinkContract,
  { list: listLinks, get: getLink, remove: deleteLink },
  { exclude: ['create', 'update'] },
  [createRouteDef, updateRoute, rotateTokenRoute],
);

export default router;
