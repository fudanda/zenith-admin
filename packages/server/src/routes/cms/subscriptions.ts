import { OpenAPIHono } from '@hono/zod-openapi';
import { cmsSubscriptionContract } from '@arcbase/shared/cms';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listCmsSubscriptionAggregates,
  listCmsSubscriptions,
} from '../../services/cms/cms-subscriptions.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

const aggregateRoute = defineContractRoute(cmsSubscriptionContract.aggregates, {
  handler: async (c) => c.json(okBody(await listCmsSubscriptionAggregates(c.req.valid('query'))), 200),
});

mountCrud(router, cmsSubscriptionContract,
  { list: listCmsSubscriptions },
  {},
  [aggregateRoute],
);

export default router;
