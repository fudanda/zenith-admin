import { OpenAPIHono } from '@hono/zod-openapi';
import { paymentMethodContract } from '@arcbase/shared/payment';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { listMethodConfigs, listEnabledMethodConfigs, getMethodConfig, updateMethodConfig } from '../../services/payment/payment-method.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

const enabledRoute = defineContractRoute(paymentMethodContract.enabled, {
  handler: async (c) => c.json(okBody(await listEnabledMethodConfigs()), 200),
});

mountCrud(router, paymentMethodContract,
  { get: getMethodConfig, update: updateMethodConfig, list: listMethodConfigs },
  {},
  [enabledRoute],
);

export default router;
