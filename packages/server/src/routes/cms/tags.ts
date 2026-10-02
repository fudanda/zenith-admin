import { OpenAPIHono } from '@hono/zod-openapi';
import { cmsTagContract } from '@arcbase/shared/cms';
import { defineContractRoute } from '../../lib/contract-route';
import { validationHook, okBody } from '../../lib/openapi-schemas';
import {
  listCmsTags,
  listAllCmsTags,
  getCmsTag,
  cmsTagService,
} from '../../services/cms/cms-tags.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

// 内容打标下拉：按内容权限放行
const allRoute = defineContractRoute(cmsTagContract.all, {
  handler: async (c) => c.json(okBody(await listAllCmsTags(c.req.valid('query').siteId)), 200),
});

mountCrud(router, cmsTagContract,
  { ...cmsTagService, list: listCmsTags, get: getCmsTag },
  {},
  [allRoute],
);

export default router;
