import { OpenAPIHono } from '@hono/zod-openapi';
import { ratePlanContract } from '@arcbase/shared/open-platform';
import { defineContractRoute } from '../../lib/contract-route';
import { validationHook, okBody } from '../../lib/openapi-schemas';
import {
  listEnabledRatePlans,
  createRatePlan,
  updateRatePlan,
  ratePlanService,
} from '../../services/open-platform/rate-plans.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

const options = defineContractRoute(ratePlanContract.options, {
  handler: async (c) => c.json(okBody(await listEnabledRatePlans()), 200),
});

mountCrud(router, ratePlanContract,
  {
    list: ratePlanService.list,
    get: ratePlanService.get,
    create: createRatePlan,
    update: updateRatePlan,
    remove: ratePlanService.remove,
  },
  {},
  [options],
);

export default router;
