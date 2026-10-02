import { OpenAPIHono } from '@hono/zod-openapi';
import { paymentCapabilityContract } from '@arcbase/shared/payment';
import { validationHook } from '../../lib/openapi-schemas';
import { listEffectivePaymentCapabilities } from '../../services/payment/payment-capability.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

mountCrud(router, paymentCapabilityContract,
  { list: listEffectivePaymentCapabilities },
);

export default router;
