import { OpenAPIHono } from '@hono/zod-openapi';
import { workflowTemplateContract } from '@arcbase/shared/workflow';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listWorkflowTemplates,
  createWorkflowTemplate,
  updateWorkflowTemplate,
  deleteWorkflowTemplate,
  cloneTemplateToDefinition,
  saveAsTemplate,
  getWorkflowTemplate,
} from '../../services/workflow/workflow-templates.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

const saveAsRoute = defineContractRoute(workflowTemplateContract.saveAs, {
  handler: async (c) => c.json(okBody(await saveAsTemplate(c.req.valid('json')), '已保存为模板'), 200),
});

const cloneRoute = defineContractRoute(workflowTemplateContract.clone, {
  handler: async (c) => c.json(okBody(await cloneTemplateToDefinition(c.req.valid('param').id, c.req.valid('json')), '已创建'), 200),
});

mountCrud(router, workflowTemplateContract,
  {
    list: listWorkflowTemplates,
    get: getWorkflowTemplate,
    create: createWorkflowTemplate,
    update: updateWorkflowTemplate,
    remove: deleteWorkflowTemplate,
  },
  {
    messages: { create: '已新增', update: '已更新', remove: '已删除' },
  },
  [saveAsRoute, cloneRoute],
);

export default router;
