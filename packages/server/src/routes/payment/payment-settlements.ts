import { OpenAPIHono } from '@hono/zod-openapi';
import { paymentSettlementContract } from '@arcbase/shared/payment';
import { setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { listSettlements, getSettlement, listSettlementItems, generateSettlement, transitionSettlement, deleteSettlement } from '../../services/payment/payment-settlement.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });
const itemsRoute = defineContractRoute(paymentSettlementContract.items, {
  handler: async (c) => c.json(okBody(await listSettlementItems(c.req.valid('param').id)), 200),
});

const generateRoute = defineContractRoute(paymentSettlementContract.generate, {
  handler: async (c) => c.json(okBody(await generateSettlement(c.req.valid('json')), '生成成功'), 200),
});

const transitionRoute = defineContractRoute(paymentSettlementContract.transition, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getSettlement(id));
    return c.json(okBody(await transitionSettlement(id, c.req.valid('json')), '流转成功'), 200);
  },
});

mountCrud(router, paymentSettlementContract,
  { list: listSettlements, get: getSettlement, remove: deleteSettlement },
  {},
  [itemsRoute, generateRoute, transitionRoute],
);

export default router;
