import { OpenAPIHono } from '@hono/zod-openapi';
import { mpTemplateContract } from '@arcbase/shared/mp';
import { setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listMpTemplates,
  deleteMpTemplate,
  syncMpTemplates,
  sendMpTemplate,
  listMpTemplateSendLogs,
  setMpTemplateIndustry,
  getMpTemplateIndustry,
  batchSendMpTemplate,
  getMpTemplateBeforeAudit,
  getMpTemplateIndustryBeforeAudit,
} from '../../services/mp/mp-template.service';
import { mountCrud } from '../_crud';

const mpTemplatesRouter = new OpenAPIHono({ defaultHook: validationHook });

async function getTemplateIndustryAuditSafe(accountId: number) {
  try {
    return await getMpTemplateIndustryBeforeAudit(accountId);
  } catch (err) {
    return {
      accountId,
      industry: null,
      auditError: err instanceof Error ? err.message : '获取行业信息失败',
    };
  }
}
const logsRoute = defineContractRoute(mpTemplateContract.logs, {
  handler: async (c) => c.json(okBody(await listMpTemplateSendLogs(c.req.valid('query'))), 200),
});

const syncRoute = defineContractRoute(mpTemplateContract.sync, {
  handler: async (c) => c.json(okBody(await syncMpTemplates(c.req.valid('json').accountId), '同步完成'), 200),
});

const sendRoute = defineContractRoute(mpTemplateContract.send, {
  handler: async (c) => c.json(okBody(await sendMpTemplate(c.req.valid('json')), '发送成功'), 200),
});
const industryGetRoute = defineContractRoute(mpTemplateContract.industry, {
  handler: async (c) => c.json(okBody(await getMpTemplateIndustry(c.req.valid('query').accountId)), 200),
});

const industrySetRoute = defineContractRoute(mpTemplateContract.setIndustry, {
  handler: async (c) => {
    const b = c.req.valid('json');
    setAuditBeforeData(c, await getTemplateIndustryAuditSafe(b.accountId));
    await setMpTemplateIndustry(b.accountId, b.industryId1, b.industryId2);
    setAuditAfterData(c, await getTemplateIndustryAuditSafe(b.accountId));
    return c.json(okBody(null, '设置成功'), 200);
  },
});

const batchSendRoute = defineContractRoute(mpTemplateContract.batchSend, {
  handler: async (c) => c.json(okBody(await batchSendMpTemplate(c.req.valid('json')), '已提交批量发送'), 200),
});

mountCrud(mpTemplatesRouter, mpTemplateContract,
  { list: listMpTemplates, get: getMpTemplateBeforeAudit, remove: deleteMpTemplate },
  {},
  [logsRoute, industryGetRoute, industrySetRoute, batchSendRoute, syncRoute, sendRoute],
);

export default mpTemplatesRouter;
