import { OpenAPIHono } from '@hono/zod-openapi';
import { directorySyncSourceContract } from '@arcbase/shared/identity';
import { defineContractRoute } from '../../lib/contract-route';
import { validationHook, okBody } from '../../lib/openapi-schemas';
import {
  listDirectorySyncSources,
  getDirectorySyncSource,
  createDirectorySyncSource,
  updateDirectorySyncSource,
  deleteDirectorySyncSource,
  testDirectorySyncSourceConnection,
  submitDirectorySyncTask,
} from '../../services/identity/directory-sync.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

const testSourceRoute = defineContractRoute(directorySyncSourceContract.test, {
  handler: async (c) => c.json(okBody(await testDirectorySyncSourceConnection(c.req.valid('param').id)), 200),
});

const previewSourceRoute = defineContractRoute(directorySyncSourceContract.preview, {
  handler: async (c) => {
    const task = await submitDirectorySyncTask(c.req.valid('param').id, true);
    return c.json(okBody(task, '预览任务已提交，请在同步记录中查看差异'), 200);
  },
});

const runSourceRoute = defineContractRoute(directorySyncSourceContract.run, {
  handler: async (c) => {
    const task = await submitDirectorySyncTask(c.req.valid('param').id, false);
    return c.json(okBody(task, '同步任务已提交'), 200);
  },
});

mountCrud(router, directorySyncSourceContract,
  {
    list: listDirectorySyncSources,
    get: getDirectorySyncSource,
    create: createDirectorySyncSource,
    update: updateDirectorySyncSource,
    remove: deleteDirectorySyncSource,
  },
  {},
  [testSourceRoute, previewSourceRoute, runSourceRoute],
);

export default router;
