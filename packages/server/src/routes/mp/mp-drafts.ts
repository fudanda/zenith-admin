import { OpenAPIHono } from '@hono/zod-openapi';
import { mpDraftContract } from '@arcbase/shared/mp';
import { setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  getMpDraft,
  mpDraftService,
  pushMpDraft,
} from '../../services/mp/mp-draft.service';
import { mountCrud } from '../_crud';

const mpDraftsRouter = new OpenAPIHono({ defaultHook: validationHook });

const pushRoute = defineContractRoute(mpDraftContract.push, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMpDraft(id));
    return c.json(okBody(await pushMpDraft(id), '推送成功'), 200);
  },
});

mountCrud(mpDraftsRouter, mpDraftContract,
  mpDraftService,
  {},
  [pushRoute],
);

export default mpDraftsRouter;
