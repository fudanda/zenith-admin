import { OpenAPIHono } from '@hono/zod-openapi';
import { aiPromptTemplateContract } from '@arcbase/shared/ai';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listPromptTemplates,
  listChatPromptTemplates,
  getPromptTemplate,
  createPromptTemplate,
  updatePromptTemplate,
  deletePromptTemplate,
  incrementPromptUsage,
  listPromptTemplateVersions,
  restorePromptTemplateVersion,
} from '../../services/ai/ai-prompt-templates.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

const available = defineContractRoute(aiPromptTemplateContract.all, {
  handler: async (c) => c.json(okBody(await listChatPromptTemplates()), 200),
});

const use = defineContractRoute(aiPromptTemplateContract.use, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await incrementPromptUsage(id);
    return c.json(okBody(null, '已记录'), 200);
  },
});
const versions = defineContractRoute(aiPromptTemplateContract.versions, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await listPromptTemplateVersions(id)), 200);
  },
});

const restoreVersion = defineContractRoute(aiPromptTemplateContract.restoreVersion, {
  handler: async (c) => {
    const { id, versionId } = c.req.valid('param');
    return c.json(okBody(await restorePromptTemplateVersion(id, versionId), '已恢复到历史版本'), 200);
  },
});

mountCrud(router, aiPromptTemplateContract,
  {
    list: listPromptTemplates,
    get: getPromptTemplate,
    create: createPromptTemplate,
    update: updatePromptTemplate,
    remove: deletePromptTemplate,
  },
  {},
  [available, use, versions, restoreVersion],
);

export default router;
