import { OpenAPIHono } from '@hono/zod-openapi';
import { wikiTemplateContract } from '@arcbase/shared/wiki';
import { defineContractRoute } from '../../lib/contract-route';
import { validationHook, okBody } from '../../lib/openapi-schemas';
import {
  listAllWikiTemplates,
  wikiTemplateService,
} from '../../services/wiki/templates.service';
import { mountCrud } from '../_crud';

const templatesRouter = new OpenAPIHono({ defaultHook: validationHook });

const allRoute = defineContractRoute(wikiTemplateContract.all, {
  handler: async (c) => c.json(okBody(await listAllWikiTemplates()), 200),
});

mountCrud(templatesRouter, wikiTemplateContract,
  wikiTemplateService,
  {},
  [allRoute],
);

export default templatesRouter;
