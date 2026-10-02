import { OpenAPIHono } from '@hono/zod-openapi';
import { tagContract } from '@arcbase/shared/platform';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { listTagGroups, tagService } from '../../services/platform/tags.service';
import { mountCrud } from '../_crud';

const tagsRouter = new OpenAPIHono({ defaultHook: validationHook });

mountCrud(tagsRouter, tagContract, tagService, {}, [
  defineContractRoute(tagContract.groups, {
    handler: async (c) => c.json(okBody(await listTagGroups()), 200),
  }),
]);

export default tagsRouter;