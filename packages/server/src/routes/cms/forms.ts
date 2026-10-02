import { OpenAPIHono } from '@hono/zod-openapi';
import { cmsFormContract } from '@arcbase/shared/cms';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listCmsForms,
  createCmsForm,
  updateCmsForm,
  deleteCmsForm,
  ensureCmsFormExists,
  mapCmsForm,
  listCmsFormSubmissions,
  deleteCmsFormSubmissions,
} from '../../services/cms/cms-forms.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listSubmissionsRoute = defineContractRoute(cmsFormContract.submissions, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { page, pageSize } = c.req.valid('query');
    return c.json(okBody(await listCmsFormSubmissions(id, page, pageSize)), 200);
  },
});

const deleteSubmissionsRoute = defineContractRoute(cmsFormContract.deleteSubmissions, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { ids } = c.req.valid('json');
    await deleteCmsFormSubmissions(id, ids);
    return c.json(okBody(null, `已删除 ${ids.length} 条提交数据`), 200);
  },
});

mountCrud(router, cmsFormContract,
  {
    list: listCmsForms,
    get: async (id: number) => mapCmsForm(await ensureCmsFormExists(id)),
    create: createCmsForm,
    update: updateCmsForm,
    remove: deleteCmsForm,
  },
  {},
  [listSubmissionsRoute, deleteSubmissionsRoute],
);

export default router;
