import { OpenAPIHono } from '@hono/zod-openapi';
import { wikiCommentContract } from '@arcbase/shared/wiki';
import { setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { validationHook, okBody } from '../../lib/openapi-schemas';
import {
  createWikiComment,
  deleteMyWikiComment,
  ensureWikiCommentExists,
  listWikiComments,
  listWikiDocComments,
  mapWikiComment,
  removeWikiComment,
  resolveWikiComment,
  updateWikiCommentStatus,
} from '../../services/wiki/comments.service';
import { mountCrud } from '../_crud';

const commentsRouter = new OpenAPIHono({ defaultHook: validationHook });

// ─── 用户端 ───────────────────────────────────────────────────────────────────

const docCommentsRoute = defineContractRoute(wikiCommentContract.docComments, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await listWikiDocComments(id)), 200);
  },
});
const resolveRoute = defineContractRoute(wikiCommentContract.resolve, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await resolveWikiComment(id), '已标记解决'), 200);
  },
});

const deleteMineRoute = defineContractRoute(wikiCommentContract.deleteMine, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await deleteMyWikiComment(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});
const statusRoute = defineContractRoute(wikiCommentContract.updateStatus, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { status } = c.req.valid('json');
    setAuditBeforeData(c, mapWikiComment(await ensureWikiCommentExists(id)));
    return c.json(okBody(await updateWikiCommentStatus(id, status), '操作成功'), 200);
  },
});

mountCrud(commentsRouter, wikiCommentContract,
  {
    list: listWikiComments,
    get: async (id: number) => mapWikiComment(await ensureWikiCommentExists(id)),
    create: createWikiComment,
    remove: removeWikiComment,
  },
  {
    messages: { create: '评论成功' },
  },
  [docCommentsRoute, deleteMineRoute, resolveRoute, statusRoute],
);

export default commentsRouter;
