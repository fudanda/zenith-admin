import { OpenAPIHono } from '@hono/zod-openapi';
import { workflowSavedViewContract } from '@arcbase/shared/workflow';
import { validationHook } from '../../lib/openapi-schemas';
import { listSavedViews, createSavedView, updateSavedView, deleteSavedView, getSavedView } from '../../services/workflow/workflow-saved-views.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

mountCrud(router, workflowSavedViewContract,
  { list: listSavedViews, get: getSavedView, create: createSavedView, update: updateSavedView, remove: deleteSavedView },
  {
    messages: { create: '已保存', update: '已更新', remove: '已删除' },
  },
);

export default router;