import { OpenAPIHono } from '@hono/zod-openapi';
import { ruleListContract } from '@arcbase/shared/rules';
import { setAuditBeforeData } from '../../middleware/guard';
import { sensitiveRateLimit } from '../../middleware/rate-limit';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listRuleLists,
  createRuleList,
  updateRuleList,
  deleteRuleList,
  listRuleListItems,
  createRuleListItem,
  batchCreateRuleListItems,
  deleteRuleListItem,
  purgeExpiredRuleListItems,
  checkRuleList,
  ensureRuleList,
  mapRuleList,
  listRuleListUsages,
} from '../../services/platform/rules-lists.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

const checkRoute = defineContractRoute(ruleListContract.check, {
  middleware: [sensitiveRateLimit],
  handler: async (c) => {
    const b = c.req.valid('json');
    return c.json(okBody(await checkRuleList(b.key, b.value)), 200);
  },
});
const usagesRoute = defineContractRoute(ruleListContract.usages, {
  handler: async (c) => c.json(okBody(await listRuleListUsages(c.req.valid('param').id)), 200),
});

const updateRoute = defineContractRoute(ruleListContract.update, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await ensureRuleList(id).then((r) => mapRuleList(r)).catch(() => null);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await updateRuleList(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute = defineContractRoute(ruleListContract.remove, {
  handler: async (c) => {
    await deleteRuleList(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const itemsRoute = defineContractRoute(ruleListContract.items, {
  handler: async (c) => c.json(okBody(await listRuleListItems(c.req.valid('param').id, c.req.valid('query'))), 200),
});

const itemCreateRoute = defineContractRoute(ruleListContract.createItem, {
  handler: async (c) => c.json(okBody(await createRuleListItem(c.req.valid('param').id, c.req.valid('json')), '新增成功'), 200),
});

const itemBatchRoute = defineContractRoute(ruleListContract.createItemsBatch, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { values, expiresAt } = c.req.valid('json');
    const added = await batchCreateRuleListItems(id, values, expiresAt);
    return c.json(okBody(null, `导入完成：新增 ${added} 条（重复值已跳过）`), 200);
  },
});

const itemDeleteRoute = defineContractRoute(ruleListContract.removeItem, {
  handler: async (c) => {
    const { id, itemId } = c.req.valid('param');
    await deleteRuleListItem(id, itemId);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const purgeExpiredRoute = defineContractRoute(ruleListContract.purgeExpiredItems, {
  handler: async (c) => {
    const removed = await purgeExpiredRuleListItems(c.req.valid('param').id);
    return c.json(okBody(null, `清理完成：删除 ${removed} 条过期条目`), 200);
  },
});

mountCrud(router, ruleListContract,
  { list: listRuleLists, create: createRuleList },
  { exclude: ['update', 'remove'] },
  [
    checkRoute,
    usagesRoute,
    updateRoute,
    deleteRoute,
    itemsRoute,
    itemCreateRoute,
    itemBatchRoute,
    itemDeleteRoute,
    purgeExpiredRoute,
  ],
);

export default router;
