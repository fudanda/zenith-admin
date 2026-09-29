import { OpenAPIHono } from '@hono/zod-openapi';
import { operationLogContract } from '@zenith/shared/platform';
import { setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook, csvStreamBody } from '../../lib/openapi-schemas';
import { streamToCsv } from '../../lib/excel-export';
import { listOperationLogs, getOperationLog, operationLogStats, cleanOperationLogs, getCleanOperationLogsBeforeAudit } from '../../services/platform/operation-logs.service';
import { mountCrud } from '../_crud';

const operationLogsRoute = new OpenAPIHono({ defaultHook: validationHook });

const exportCsvRoute = defineContractRoute(operationLogContract.exportCsv, {
  handler: async (c) => {
    const filters = c.req.valid('query');
    async function* rows() {
      for (let page = 1; ; page++) {
        const result = await listOperationLogs({ ...filters, page, pageSize: 200 });
        for (const row of result.list) yield row;
        if (result.list.length < 200) break;
      }
    }
    const safe = (value: unknown) => {
      const text = String(value ?? '');
      return /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
    };
    return csvStreamBody(c, streamToCsv([
      { key: 'id', header: 'ID' }, { key: 'userId', header: '操作人ID' },
      { key: 'tenantId', header: '租户ID' }, { key: 'description', header: '操作', transform: safe },
      { key: 'module', header: '资源', transform: safe }, { key: 'requestId', header: '请求ID' },
      { key: 'createdAt', header: '时间' },
    ], rows()), 'operation-logs.csv');
  },
});

const statsRoute = defineContractRoute(operationLogContract.stats, {
  handler: async (c) => c.json(okBody(await operationLogStats(c.req.valid('query').days)), 200),
});

const cleanRoute = defineContractRoute(operationLogContract.clean, {
  handler: async (c) => {
    const { days } = c.req.valid('query');
    const before = await getCleanOperationLogsBeforeAudit(days);
    setAuditBeforeData(c, before);
    const deleted = await cleanOperationLogs(days);
    setAuditAfterData(c, { days, deleted });
    return c.json(okBody(null, `共删除 ${deleted} 条操作日志`), 200);
  },
});

mountCrud(operationLogsRoute, operationLogContract,
  { list: listOperationLogs, get: getOperationLog },
  {},
  [exportCsvRoute, statsRoute, cleanRoute],
);

export default operationLogsRoute;
