import { OpenAPIHono } from '@hono/zod-openapi';
import { retentionPolicyContract } from '@arcbase/shared/ops';
import { setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listPolicies,
  previewPolicyPending,
  runPolicyNow,
  updatePolicy,
} from '../../services/ops/retention.service';
import { mountCrud } from '../_crud';

const retentionRouter = new OpenAPIHono({ defaultHook: validationHook });

const updateRoute = defineContractRoute(retentionPolicyContract.update, {
  handler: async (c) => {
    const { key } = c.req.valid('param');
    const list = await listPolicies();
    setAuditBeforeData(c, list.find((item) => item.key === key));
    const updated = await updatePolicy(key, c.req.valid('json'));
    setAuditAfterData(c, updated);
    return c.json(okBody(updated), 200);
  },
});

const previewRoute = defineContractRoute(retentionPolicyContract.preview, {
  handler: async (c) => c.json(okBody(await previewPolicyPending(c.req.valid('param').key)), 200),
});

const runRoute = defineContractRoute(retentionPolicyContract.run, {
  handler: async (c) => {
    const { key } = c.req.valid('param');
    setAuditBeforeData(c, await previewPolicyPending(key));
    const deleted = await runPolicyNow(key);
    setAuditAfterData(c, { key, deleted });
    return c.json(okBody({ key, deleted }, `已清理 ${deleted} 行`), 200);
  },
});

mountCrud(retentionRouter, retentionPolicyContract,
  { list: listPolicies },
  { exclude: ['update'] },
  [updateRoute, previewRoute, runRoute],
);

export default retentionRouter;
