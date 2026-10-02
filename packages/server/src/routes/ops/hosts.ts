import { OpenAPIHono } from '@hono/zod-openapi';
import { opsHostContract } from '@arcbase/shared/ops';
import { setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { platformHostOnly } from '../../lib/host-access';
import {
  createOpsHost,
  deleteOpsHost,
  getOpsHost,
  importOpsHostFromSshProfile,
  listOpsHosts,
  probeAllOpsHosts,
  probeOpsHost,
  resetOpsHostKey,
  testOpsHostConnection,
  updateOpsHost,
} from '../../services/ops/hosts.service';
import { currentUser } from '../../lib/context';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

const testRoute = defineContractRoute(opsHostContract.test, {
  middleware: [platformHostOnly],
  handler: async (c) => c.json(okBody(await testOpsHostConnection(c.req.valid('param').id)), 200),
});

const probeRoute = defineContractRoute(opsHostContract.probe, {
  middleware: [platformHostOnly],
  handler: async (c) => c.json(okBody(await probeOpsHost(c.req.valid('param').id)), 200),
});

const probeAllRoute = defineContractRoute(opsHostContract.probeAll, {
  middleware: [platformHostOnly],
  handler: async (c) => {
    await probeAllOpsHosts();
    return c.json(okBody(await listOpsHosts()), 200);
  },
});

const resetKeyRoute = defineContractRoute(opsHostContract.resetHostKey, {
  middleware: [platformHostOnly],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getOpsHost(id));
    await resetOpsHostKey(id);
    return c.json(okBody(null, '已重置,下次连接将重新记录指纹'), 200);
  },
});

const importSshProfileRoute = defineContractRoute(opsHostContract.importSshProfile, {
  middleware: [platformHostOnly],
  handler: async (c) => {
    const host = await importOpsHostFromSshProfile(c.req.valid('param').profileId, currentUser().userId);
    return c.json(okBody(host, '已导入'), 200);
  },
});

mountCrud(router, opsHostContract,
  { list: listOpsHosts, get: getOpsHost, create: createOpsHost, update: updateOpsHost, remove: deleteOpsHost },
  {
    messages: { create: '已创建', update: '已更新', remove: '已删除' },
    middleware: [platformHostOnly],
  },
  [testRoute, probeRoute, probeAllRoute, resetKeyRoute, importSshProfileRoute],
);

export default router;
