import { OpenAPIHono } from '@hono/zod-openapi';
import { reportDashboardOpsContract } from '@arcbase/shared/report';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, jsonContent, okBody, validationHook, errBody } from '../../lib/openapi-schemas';
import {
  createVersion,
  createShare,
  createEmbedToken,
  deleteShare,
  diffVersion,
  listEmbedTokens,
  listShares,
  listVersions,
  revokeEmbedToken,
  restoreVersion,
  toggleFavorite,
  updateShare,
} from '../../services/report/report-ops.service';
import {
  createComment,
  deleteComment,
  listComments,
  resolveComment,
  updateComment,
} from '../../services/report/report-comment.service';
import { DashboardRevisionConflictError } from '../../services/report/report-dashboard.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const notFound = { 404: { content: jsonContent(ErrorResponse), description: '不存在' } } as const;

// ── 版本 ──
const listVersionsRoute = defineContractRoute(reportDashboardOpsContract.versions, {
  handler: async (c) => c.json(okBody(await listVersions(c.req.valid('param').id)), 200),
});

const createVersionRoute = defineContractRoute(reportDashboardOpsContract.createVersion, {
  handler: async (c) => c.json(okBody(await createVersion(c.req.valid('param').id, c.req.valid('json')), '已保存版本'), 200),
});

const diffVersionRoute = defineContractRoute(reportDashboardOpsContract.versionDiff, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const query = c.req.valid('query');
    return c.json(okBody(await diffVersion(id, query.left, query.right)), 200);
  },
});

const restoreVersionRoute = defineContractRoute(reportDashboardOpsContract.restoreVersion, {
  responses: { ...notFound, ...dashboardConflictResponse },
  handler: async (c) => {
    const { id, versionId } = c.req.valid('param');
    try {
      await restoreVersion(id, versionId, c.req.valid('json').expectedRevision);
      return c.json(okBody(null, '已恢复到该版本'), 200);
    } catch (err) {
      if (err instanceof DashboardRevisionConflictError) {
        return c.json({
          ...errBody(err.message, 409),
          data: { currentRevision: err.currentRevision, dashboard: err.currentDashboard },
        }, 409);
      }
      throw err;
    }
  },
});

// ── 收藏 ──
const favoriteRoute = defineContractRoute(reportDashboardOpsContract.favorite, {
  handler: async (c) => c.json(okBody(await toggleFavorite(c.req.valid('param').id)), 200),
});

// ── 分享 ──
const listSharesRoute = defineContractRoute(reportDashboardOpsContract.shares, {
  handler: async (c) => c.json(okBody(await listShares(c.req.valid('param').id)), 200),
});

const createShareRoute = defineContractRoute(reportDashboardOpsContract.createShare, {
  handler: async (c) => c.json(okBody(await createShare(c.req.valid('param').id, c.req.valid('json')), '创建成功'), 200),
});

const updateShareRoute = defineContractRoute(reportDashboardOpsContract.updateShare, {
  responses: notFound,
  handler: async (c) => c.json(okBody(await updateShare(c.req.valid('param').shareId, c.req.valid('json')), '更新成功'), 200),
});

const deleteShareRoute = defineContractRoute(reportDashboardOpsContract.removeShare, {
  responses: notFound,
  handler: async (c) => {
    await deleteShare(c.req.valid('param').shareId);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

// ── Scoped Embed Token ──
const listEmbedTokensRoute = defineContractRoute(reportDashboardOpsContract.embedTokens, {
  handler: async (c) => c.json(okBody(await listEmbedTokens(c.req.valid('param').id)), 200),
});

const createEmbedTokenRoute = defineContractRoute(reportDashboardOpsContract.createEmbedToken, {
  handler: async (c) => c.json(okBody(await createEmbedToken(c.req.valid('param').id, c.req.valid('json')), '创建成功'), 200),
});

const revokeEmbedTokenRoute = defineContractRoute(reportDashboardOpsContract.revokeEmbedToken, {
  handler: async (c) => {
    await revokeEmbedToken(c.req.valid('param').embedTokenId);
    return c.json(okBody(null, '撤销成功'), 200);
  },
});

// ── 评论 ──
const listCommentsRoute = defineContractRoute(reportDashboardOpsContract.comments, {
  handler: async (c) => c.json(okBody(await listComments(c.req.valid('param').id, c.req.valid('query'))), 200),
});

const createCommentRoute = defineContractRoute(reportDashboardOpsContract.createComment, {
  handler: async (c) => c.json(okBody(await createComment(c.req.valid('param').id, c.req.valid('json')), '已发表'), 200),
});

const updateCommentRoute = defineContractRoute(reportDashboardOpsContract.updateComment, {
  handler: async (c) => {
    const { id, commentId } = c.req.valid('param');
    return c.json(okBody(await updateComment(id, commentId, c.req.valid('json')), '更新成功'), 200);
  },
});

const resolveCommentRoute = defineContractRoute(reportDashboardOpsContract.resolveComment, {
  handler: async (c) => {
    const { id, commentId } = c.req.valid('param');
    return c.json(okBody(await resolveComment(id, commentId, c.req.valid('json')), '操作成功'), 200);
  },
});

const deleteCommentRoute = defineContractRoute(reportDashboardOpsContract.removeComment, {
  responses: notFound,
  handler: async (c) => {
    const { id, commentId } = c.req.valid('param');
    await deleteComment(id, commentId);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([
  listVersionsRoute,
  createVersionRoute,
  diffVersionRoute,
  restoreVersionRoute,
  favoriteRoute,
  listSharesRoute,
  createShareRoute,
  updateShareRoute,
  deleteShareRoute,
  listEmbedTokensRoute,
  createEmbedTokenRoute,
  revokeEmbedTokenRoute,
  listCommentsRoute,
  createCommentRoute,
  updateCommentRoute,
  resolveCommentRoute,
  deleteCommentRoute,
] as const);

export default router;
import { dashboardConflictResponse } from './report-dashboards';
