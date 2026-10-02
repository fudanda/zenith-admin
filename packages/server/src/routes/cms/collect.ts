import { OpenAPIHono } from '@hono/zod-openapi';
import { cmsCollectContract } from '@arcbase/shared/cms';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listCollectRules,
  createCollectRule,
  updateCollectRule,
  deleteCollectRule,
  ensureCollectRuleRunnable,
  listCollectItems,
} from '../../services/cms/cms-collect.service';
import { mapAsyncTask, submitAsyncTask } from '../../lib/task-center';
import { currentUser } from '../../lib/context';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

const updateRouteDef = defineContractRoute(cmsCollectContract.update, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await updateCollectRule(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRouteDef = defineContractRoute(cmsCollectContract.remove, {
  handler: async (c) => {
    await deleteCollectRule(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const runRoute = defineContractRoute(cmsCollectContract.run, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const rule = await ensureCollectRuleRunnable(id);
    const user = currentUser();
    const task = await submitAsyncTask({
      taskType: 'cms-collect-run',
      title: `CMS 采集：${rule.name}`,
      payload: { ruleId: rule.id, operatorId: user.userId },
    });
    return c.json(okBody(mapAsyncTask(task), '任务已提交，可在下方查看进度与明细'), 200);
  },
});

const itemsRoute = defineContractRoute(cmsCollectContract.items, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await listCollectItems({ ...c.req.valid('query'), ruleId: id })), 200);
  },
});

mountCrud(router, cmsCollectContract,
  { list: listCollectRules, create: createCollectRule },
  { exclude: ['update', 'remove'] },
  [updateRouteDef, deleteRouteDef, runRoute, itemsRoute],
);

export default router;
