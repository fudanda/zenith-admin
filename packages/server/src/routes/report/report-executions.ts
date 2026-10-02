import { OpenAPIHono } from '@hono/zod-openapi';
import { reportExecutionContract } from '@arcbase/shared/report';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { parseDateRangeEnd, parseDateRangeStart } from '../../lib/datetime';
import { getDatasetExecutionStats, getReportRuntimeGovernance, listDatasetExecutionLogs } from '../../services/report/report-dataset.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });
const statsRoute = defineContractRoute(reportExecutionContract.stats, {
  handler: async (c) => {
    const query = c.req.valid('query');
    return c.json(okBody(await getDatasetExecutionStats({
      ...query,
      startAt: parseDateRangeStart(query.startAt) ?? undefined,
      endAt: parseDateRangeEnd(query.endAt) ?? undefined,
    })), 200);
  },
});

const governanceRoute = defineContractRoute(reportExecutionContract.governance, {
  handler: async (c) => c.json(okBody(getReportRuntimeGovernance()), 200),
});

mountCrud(router, reportExecutionContract,
  { list: listDatasetExecutionLogs },
  {},
  [statsRoute, governanceRoute],
);

export default router;
