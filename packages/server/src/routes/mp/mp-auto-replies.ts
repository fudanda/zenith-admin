import { OpenAPIHono } from '@hono/zod-openapi';
import { mpAutoReplyContract } from '@arcbase/shared/mp';
import { setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  mpAutoReplyService,
  listMpUnmatchedKeywords,
  deleteMpUnmatchedKeyword,
  getMpUnmatchedKeywordBeforeAudit,
} from '../../services/mp/mp-auto-reply.service';
import { mountCrud } from '../_crud';

const mpAutoRepliesRouter = new OpenAPIHono({ defaultHook: validationHook });

const unmatchedListRoute = defineContractRoute(mpAutoReplyContract.unmatched, {
  handler: async (c) => {
    const q = c.req.valid('query');
    return c.json(okBody(await listMpUnmatchedKeywords(q.accountId, q.page, q.pageSize)), 200);
  },
});

const unmatchedDeleteRoute = defineContractRoute(mpAutoReplyContract.removeUnmatched, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getMpUnmatchedKeywordBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await deleteMpUnmatchedKeyword(id);
    return c.json(okBody(null, '已删除'), 200);
  },
});

mountCrud(mpAutoRepliesRouter, mpAutoReplyContract,
  mpAutoReplyService,
  {},
  [unmatchedListRoute, unmatchedDeleteRoute],
);

export default mpAutoRepliesRouter;
