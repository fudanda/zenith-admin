import { OpenAPIHono } from '@hono/zod-openapi';
import { loginLogContract } from '@arcbase/shared/identity';
import { setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { validationHook, okBody, csvStreamBody } from '../../lib/openapi-schemas';
import { streamToCsv } from '../../lib/excel-export';
import { listLoginLogs, loginLogStats, cleanLoginLogs, getCleanLoginLogsBeforeAudit } from '../../services/identity/login-logs.service';
import { mountCrud } from '../_crud';

const loginLogsRoute = new OpenAPIHono({ defaultHook: validationHook });

const exportCsvRoute = defineContractRoute(loginLogContract.exportCsv, {
  handler: async (c) => {
    const filters = c.req.valid('query');
    async function* rows() {
      for (let page = 1; ; page++) {
        const result = await listLoginLogs({ ...filters, page, pageSize: 200 });
        for (const row of result.list) yield row;
        if (result.list.length < 200) break;
      }
    }
    const safe = (value: unknown) => {
      const text = String(value ?? '');
      return /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
    };
    return csvStreamBody(c, streamToCsv([
      { key: 'id', header: 'ID' }, { key: 'userId', header: '用户ID' },
      { key: 'username', header: '用户名', transform: safe }, { key: 'eventType', header: '事件类型' },
      { key: 'ip', header: 'IP' }, { key: 'status', header: '状态' },
      { key: 'message', header: '说明', transform: safe }, { key: 'createdAt', header: '时间' },
    ], rows()), 'login-logs.csv');
  },
});

const statsRoute = defineContractRoute(loginLogContract.stats, {
  handler: async (c) => c.json(okBody(await loginLogStats(c.req.valid('query').days)), 200),
});

const cleanRoute = defineContractRoute(loginLogContract.clean, {
  handler: async (c) => {
    const { days } = c.req.valid('query');
    const before = await getCleanLoginLogsBeforeAudit(days);
    setAuditBeforeData(c, before);
    const deleted = await cleanLoginLogs(days);
    setAuditAfterData(c, { days, deleted });
    return c.json(okBody(null, `共删除 ${deleted} 条登录日志`), 200);
  },
});

mountCrud(loginLogsRoute, loginLogContract,
  { list: listLoginLogs },
  {},
  [exportCsvRoute, statsRoute, cleanRoute],
);

export default loginLogsRoute;
