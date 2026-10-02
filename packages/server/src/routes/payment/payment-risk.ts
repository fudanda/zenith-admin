import { OpenAPIHono } from '@hono/zod-openapi';
import { paymentRiskRuleContract } from '@arcbase/shared/payment';
import { validationHook } from '../../lib/openapi-schemas';
import { paymentRiskRuleService } from '../../services/payment/payment-risk.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

mountCrud(router, paymentRiskRuleContract,
  paymentRiskRuleService,
);

export default router;
