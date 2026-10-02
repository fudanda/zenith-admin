import { OpenAPIHono } from '@hono/zod-openapi';
import { mpTagContract } from '@arcbase/shared/mp';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  mpTagService,
  syncMpTags,
} from '../../services/mp/mp-tag.service';
import { mountCrud } from '../_crud';

const mpTagsRouter = new OpenAPIHono({ defaultHook: validationHook });
const syncRoute = defineContractRoute(mpTagContract.sync, {
  handler: async (c) => c.json(okBody(await syncMpTags(c.req.valid('json').accountId), '同步完成'), 200),
});

mountCrud(mpTagsRouter, mpTagContract,
  mpTagService,
  {},
  [syncRoute],
);

export default mpTagsRouter;
