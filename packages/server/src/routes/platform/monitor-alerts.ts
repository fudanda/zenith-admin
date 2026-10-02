import { OpenAPIHono } from '@hono/zod-openapi';
import { monitorAlertContract } from '@arcbase/shared/platform';
import { setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listRules,
  createRule,
  updateRule,
  deleteRule,
  deleteRules,
  setRuleEnabled,
  setRulesEnabled,
  listEvents,
  handleEvent,
  handleEvents,
  getAlertOverview,
  testRule,
  getMonitorAlertRuleBeforeAudit,
  getMonitorAlertEventBeforeAudit,
} from '../../services/platform/monitor-alert.service';
import { mountCrud } from '../_crud';

const monitorAlertsRouter = new OpenAPIHono({ defaultHook: validationHook });

// ─── 告警概览 ──────────────────────────────────────────────────────────────
const overview = defineContractRoute(monitorAlertContract.overview, {
  handler: async (c) => c.json(okBody(await getAlertOverview(c.req.valid('query').range)), 200),
});

// ─── 告警事件（先于 /{id} 注册，避免冲突）──────────────────────────────────
const eventsList = defineContractRoute(monitorAlertContract.events, {
  handler: async (c) => c.json(okBody(await listEvents(c.req.valid('query'))), 200),
});

// 批量必须先于 `/events/{id}/handle` 注册，否则 `batch` 会被当成事件 id
const eventBatchHandle = defineContractRoute(monitorAlertContract.handleEventsBatch, {
  handler: async (c) => {
    const { ids, ...input } = c.req.valid('json');
    const count = await handleEvents(ids, input);
    return c.json(okBody(null, `已处理 ${count} 条告警`), 200);
  },
});

const eventHandle = defineContractRoute(monitorAlertContract.handleEvent, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMonitorAlertEventBeforeAudit(id));
    return c.json(okBody(await handleEvent(id, c.req.valid('json')), '操作成功'), 200);
  },
});
const ruleToggle = defineContractRoute(monitorAlertContract.setEnabled, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMonitorAlertRuleBeforeAudit(id));
    return c.json(okBody(await setRuleEnabled(id, c.req.valid('json').enabled), '操作成功'), 200);
  },
});

const ruleBatchToggle = defineContractRoute(monitorAlertContract.setEnabledBatch, {
  handler: async (c) => {
    const { ids, enabled } = c.req.valid('json');
    const count = await setRulesEnabled(ids, enabled);
    return c.json(okBody(null, `已${enabled ? '启用' : '停用'} ${count} 条规则`), 200);
  },
});
const ruleTest = defineContractRoute(monitorAlertContract.test, {
  handler: async (c) => c.json(okBody(await testRule(c.req.valid('param').id), '测试通知已发送'), 200),
});

mountCrud(monitorAlertsRouter, monitorAlertContract,
  {
    list: listRules,
    get: getMonitorAlertRuleBeforeAudit,
    create: createRule,
    update: updateRule,
    remove: deleteRule,
    removeMany: deleteRules,
  },
  { messages: { removeBatch: '删除成功' } },
  [overview, eventsList, eventBatchHandle, eventHandle, ruleBatchToggle, ruleTest, ruleToggle],
);

export default monitorAlertsRouter;
