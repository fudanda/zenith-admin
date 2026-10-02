import { OpenAPIHono } from '@hono/zod-openapi';
import { aiEvalContract } from '@arcbase/shared/ai';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listEvalDatasets,
  createEvalDataset,
  updateEvalDataset,
  deleteEvalDataset,
  listEvalItems,
  addEvalItems,
  deleteEvalItem,
  runEvalExperiment,
  listEvalExperiments,
  getEvalExperimentResults,
} from '../../services/ai/ai-eval.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

const update = defineContractRoute(aiEvalContract.update, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await updateEvalDataset(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const remove = defineContractRoute(aiEvalContract.remove, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await deleteEvalDataset(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const items = defineContractRoute(aiEvalContract.items, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await listEvalItems(id)), 200);
  },
});

const addItems = defineContractRoute(aiEvalContract.addItems, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await addEvalItems(id, c.req.valid('json')), '添加成功'), 200);
  },
});

const removeItem = defineContractRoute(aiEvalContract.removeItem, {
  handler: async (c) => {
    const { id, itemId } = c.req.valid('param');
    await deleteEvalItem(id, itemId);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const runExperiment = defineContractRoute(aiEvalContract.runExperiment, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await runEvalExperiment(id, c.req.valid('json')), '实验已发起'), 200);
  },
});

const experiments = defineContractRoute(aiEvalContract.experiments, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await listEvalExperiments(id)), 200);
  },
});

const experimentResults = defineContractRoute(aiEvalContract.experimentDetail, {
  handler: async (c) => {
    const { id, experimentId } = c.req.valid('param');
    return c.json(okBody(await getEvalExperimentResults(id, experimentId)), 200);
  },
});

mountCrud(router, aiEvalContract,
  { create: createEvalDataset, list: listEvalDatasets },
  { exclude: ['update', 'remove'] },
  [update, remove, items, addItems, removeItem, runExperiment, experiments, experimentResults],
);

export default router;
