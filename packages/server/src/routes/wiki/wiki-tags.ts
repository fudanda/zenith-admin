import { OpenAPIHono } from '@hono/zod-openapi';
import { wikiTagContract } from '@arcbase/shared/wiki';
import { defineContractRoute } from '../../lib/contract-route';
import { validationHook, okBody } from '../../lib/openapi-schemas';
import {
  createWikiTag,
  deleteWikiTag,
  getWikiTag,
  listAllWikiTags,
  listWikiTags,
  updateWikiTag,
} from '../../services/wiki/tags.service';
import { mountCrud } from '../_crud';

const tagsRouter = new OpenAPIHono({ defaultHook: validationHook });
const allRoute = defineContractRoute(wikiTagContract.all, {
  handler: async (c) => c.json(okBody(await listAllWikiTags()), 200),
});

mountCrud(tagsRouter, wikiTagContract,
  {
    list: listWikiTags,
    get: getWikiTag,
    create: createWikiTag,
    update: updateWikiTag,
    remove: deleteWikiTag,
  },
  {},
  [allRoute],
);

export default tagsRouter;
