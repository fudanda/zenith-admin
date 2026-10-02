import { OpenAPIHono } from '@hono/zod-openapi';
import { paymentFeeRuleContract } from '@arcbase/shared/payment';
import { validationHook } from '../../lib/openapi-schemas';
import { paymentFeeRuleService } from '../../services/payment/payment-fee.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

mountCrud(router, paymentFeeRuleContract,
  paymentFeeRuleService,
);

export default router;
