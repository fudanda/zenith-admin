import { OpenAPIHono } from '@hono/zod-openapi';
import { workflowQuickPhraseContract } from '@arcbase/shared/workflow';
import { validationHook } from '../../lib/openapi-schemas';
import {
  listMyQuickPhrases,
  createMyQuickPhrase,
  updateMyQuickPhrase,
  deleteMyQuickPhrase,
  getMyQuickPhrase,
} from '../../services/workflow/workflow-quick-phrases.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

mountCrud(router, workflowQuickPhraseContract,
  {
    list: listMyQuickPhrases,
    get: getMyQuickPhrase,
    create: createMyQuickPhrase,
    update: updateMyQuickPhrase,
    remove: deleteMyQuickPhrase,
  },
  {
    messages: { create: '已新增', update: '已更新', remove: '已删除' },
  },
);

export default router;
