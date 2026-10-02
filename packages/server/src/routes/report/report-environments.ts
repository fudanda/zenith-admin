import { OpenAPIHono } from '@hono/zod-openapi';
import { reportEnvironmentContract } from '@arcbase/shared/report';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  createReportEnvironment,
  createReportEnvironmentPromotion,
  deleteReportEnvironment,
  listReportEnvironmentPromotions,
  listReportEnvironments,
  transitionReportEnvironmentPromotion,
  updateReportEnvironment,
  getReportEnvironment,
} from '../../services/report/report-governance.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listPromotionsRoute = defineContractRoute(reportEnvironmentContract.promotions, {
  handler: async (c) => c.json(okBody(await listReportEnvironmentPromotions(c.req.valid('query'))), 200),
});

const createPromotionRoute = defineContractRoute(reportEnvironmentContract.createPromotion, {
  handler: async (c) => c.json(okBody(await createReportEnvironmentPromotion(c.req.valid('json')), '创建成功'), 200),
});

const transitionPromotionRoute = defineContractRoute(reportEnvironmentContract.transitionPromotion, {
  handler: async (c) => c.json(okBody(await transitionReportEnvironmentPromotion(c.req.valid('param').id, c.req.valid('json')), '操作成功'), 200),
});

mountCrud(router, reportEnvironmentContract,
  {
    create: createReportEnvironment,
    list: listReportEnvironments,
    get: getReportEnvironment,
    update: updateReportEnvironment,
    remove: deleteReportEnvironment,
  },
  {},
  [listPromotionsRoute, createPromotionRoute, transitionPromotionRoute],
);

export default router;
