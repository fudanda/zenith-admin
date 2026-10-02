import { OpenAPIHono, z } from '@hono/zod-openapi';
import { DRIVE_UPLOAD_CONFLICT_POLICIES, driveNodeContract } from '@arcbase/shared/drive';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, apiResponse, errBody, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
import { supportsRange, rangeContentHeaders } from '../../lib/http-range';
import {
  copyDriveNodes,
  createDriveFolder,
  deleteDriveNodes,
  emptyRecycle,
  listDriveNodes,
  listRecycleNodes,
  moveDriveNodes,
  purgeDriveNodes,
  restoreDriveNodes,
} from '../../services/drive/drive-nodes.service';
import {
  abortDriveUpload,
  completeDriveUpload,
  getDriveUploadStatus,
  initDriveUpload,
  precheckDriveUpload,
  simpleDriveUpload,
  uploadDriveChunk,
} from '../../services/drive/drive-upload.service';
import { listRecentNodes, listSharedWithMe, listStarredNodes, searchDriveNodes } from '../../services/drive/drive-views.service';
import { batchDownloadDriveNodes } from '../../services/drive/drive-tasks.service';
import { ensureDriveUploadDirectories } from '../../services/drive/drive-directories.service';
import { attachmentDisposition, inlineOrAttachmentDisposition } from '../../lib/content-disposition';
import { mountCrud } from '../_crud';

/**
 * 网盘节点静态路径路由（列表 / 个人视图 / 回收站 / 批量操作 / 上传）。
 * 单节点 /{id}/... 路由在 drive-node-item.ts，两者按顺序挂载在同一路径。
 */
const router = new OpenAPIHono({ defaultHook: validationHook });

/** 受控内容流式响应（登录接口与外链接口共用） */
export function streamStoredContent(input: {
  stream: ReadableStream;
  contentType: string;
  fileName: string;
  size: number;
  provider: string;
  range: { start: number; end: number } | null;
  download: boolean;
  etag: string;
}) {
  return new Response(input.stream, {
    status: input.range ? 206 : 200,
    headers: {
      'Content-Type': input.contentType,
      'Content-Disposition': inlineOrAttachmentDisposition(input.contentType, input.fileName, input.download),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
      ETag: input.etag,
      'Accept-Ranges': supportsRange(input.provider) ? 'bytes' : 'none',
      ...rangeContentHeaders(input.range, input.size),
    },
  });
}

/** 二进制内容接口在契约 200 之外的额外响应：Range 分片与非法 Range */
export const binaryResponses = {
  206: { content: { 'application/octet-stream': { schema: z.string() } }, description: '文件内容分片' },
  416: { content: jsonContent(ErrorResponse), description: 'Range 不合法' },
} as const;

const searchRoute = defineContractRoute(driveNodeContract.search, {
  handler: async (c) => c.json(okBody(await searchDriveNodes(c.req.valid('query'))), 200),
});

const sharedRoute = defineContractRoute(driveNodeContract.sharedWithMe, {
  handler: async (c) => c.json(okBody(await listSharedWithMe(c.req.valid('query'))), 200),
});

const starredRoute = defineContractRoute(driveNodeContract.starred, {
  handler: async (c) => c.json(okBody(await listStarredNodes(c.req.valid('query'))), 200),
});

const recentRoute = defineContractRoute(driveNodeContract.recent, {
  handler: async (c) => c.json(okBody(await listRecentNodes(c.req.valid('query'))), 200),
});

// ─── 回收站 ───────────────────────────────────────────────────────────────────

const recycleListRoute = defineContractRoute(driveNodeContract.recycle, {
  handler: async (c) => c.json(okBody(await listRecycleNodes(c.req.valid('query'))), 200),
});

const recycleRestoreRoute = defineContractRoute(driveNodeContract.restore, {
  handler: async (c) => {
    const count = await restoreDriveNodes(c.req.valid('json').ids);
    return c.json(okBody(null, `已还原 ${count} 个项目`), 200);
  },
});

const recyclePurgeRoute = defineContractRoute(driveNodeContract.purge, {
  handler: async (c) => {
    const count = await purgeDriveNodes(c.req.valid('json').ids);
    return c.json(okBody(null, `已彻底删除 ${count} 个节点`), 200);
  },
});

const recycleEmptyRoute = defineContractRoute(driveNodeContract.emptyRecycle, {
  handler: async (c) => {
    const count = await emptyRecycle(c.req.valid('query').spaceId);
    return c.json(okBody(null, `已彻底删除 ${count} 个节点`), 200);
  },
});

// ─── 新建 / 移动 / 复制 / 删除 ─────────────────────────────────────────────────

const createFolderRoute = defineContractRoute(driveNodeContract.createFolder, {
  handler: async (c) => c.json(okBody(await createDriveFolder(c.req.valid('json')), '创建成功'), 200),
});

const moveRoute = defineContractRoute(driveNodeContract.move, {
  handler: async (c) => {
    const count = await moveDriveNodes(c.req.valid('json'));
    return c.json(okBody(null, `已移动 ${count} 个项目`), 200);
  },
});

const copyRoute = defineContractRoute(driveNodeContract.copy, {
  handler: async (c) => c.json(okBody(await copyDriveNodes(c.req.valid('json'))), 200),
});

const batchDeleteRoute = defineContractRoute(driveNodeContract.removeBatch, {
  handler: async (c) => {
    const count = await deleteDriveNodes(c.req.valid('json').ids);
    return c.json(okBody(null, `已删除 ${count} 个项目到回收站`), 200);
  },
});

const batchDownloadRoute = defineContractRoute(driveNodeContract.batchDownload, {
  // 同步打包返回 zip 流；超过阈值以 JSON 信封返回任务信息
  responses: {
    200: {
      content: {
        'application/json': { schema: apiResponse(driveNodeContract.batchDownload.response) },
        'application/zip': { schema: z.string().openapi({ format: 'binary' }) },
      },
      description: '同步打包返回 zip 流；超过阈值返回任务信息',
    },
  },
  handler: async (c) => {
    const result = await batchDownloadDriveNodes(c.req.valid('json').ids);
    if (result.mode === 'task') return c.json(okBody(result.result, '文件较多，已转为后台打包，完成后通知'), 200);
    return new Response(result.stream, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': attachmentDisposition(result.filename),
        'Cache-Control': 'private, no-store',
      },
    });
  },
});

// ─── 上传 ─────────────────────────────────────────────────────────────────────

const precheckRoute = defineContractRoute(driveNodeContract.precheck, {
  handler: async (c) => c.json(okBody(await precheckDriveUpload(c.req.valid('json'))), 200),
});

const ensureDirectoriesRoute = defineContractRoute(driveNodeContract.ensureDirectories, {
  handler: async (c) => c.json(okBody(await ensureDriveUploadDirectories(c.req.valid('json'))), 200),
});

const uploadRoute = defineContractRoute(driveNodeContract.upload, {
  responses: { 409: { content: jsonContent(ErrorResponse), description: '同名文件已存在' } },
  handler: async (c) => {
    const body = await c.req.parseBody();
    const file = body.file;
    if (typeof (file as File)?.arrayBuffer !== 'function') return c.json(errBody('请选择要上传的文件', 400), 400);
    const spaceId = Number(body.spaceId);
    if (!Number.isInteger(spaceId) || spaceId <= 0) return c.json(errBody('缺少 spaceId', 400), 400);
    const parentRaw = body.parentId ? Number(body.parentId) : null;
    const parentId = parentRaw && Number.isInteger(parentRaw) && parentRaw > 0 ? parentRaw : null;
    const policyRaw = typeof body.conflictPolicy === 'string' ? body.conflictPolicy : 'rename';
    const conflictPolicy = (DRIVE_UPLOAD_CONFLICT_POLICIES as readonly string[]).includes(policyRaw) ? policyRaw as typeof DRIVE_UPLOAD_CONFLICT_POLICIES[number] : 'rename';
    const node = await simpleDriveUpload(file as File, { spaceId, parentId, conflictPolicy });
    return c.json(okBody(node, '上传成功'), 200);
  },
});

const uploadInitRoute = defineContractRoute(driveNodeContract.uploadInit, {
  handler: async (c) => c.json(okBody(await initDriveUpload(c.req.valid('json'))), 200),
});

const uploadChunkRoute = defineContractRoute(driveNodeContract.uploadChunk, {
  handler: async (c) => {
    const body = await c.req.parseBody();
    const uploadId = typeof body.uploadId === 'string' ? body.uploadId : '';
    const index = Number(body.index);
    const chunk = body.chunk;
    if (!uploadId || !Number.isFinite(index) || typeof (chunk as File)?.arrayBuffer !== 'function') {
      return c.json(errBody('分片参数不完整', 400), 400);
    }
    return c.json(okBody(await uploadDriveChunk(uploadId, index, chunk as File)), 200);
  },
});

const uploadCompleteRoute = defineContractRoute(driveNodeContract.uploadComplete, {
  responses: { 409: { content: jsonContent(ErrorResponse), description: '同名文件已存在' } },
  handler: async (c) => c.json(okBody(await completeDriveUpload(c.req.valid('json')), '上传成功'), 200),
});

const uploadStatusRoute = defineContractRoute(driveNodeContract.uploadStatus, {
  handler: async (c) => c.json(okBody(await getDriveUploadStatus(c.req.valid('param').uploadId)), 200),
});

const uploadAbortRoute = defineContractRoute(driveNodeContract.uploadAbort, {
  handler: async (c) => {
    await abortDriveUpload(c.req.valid('param').uploadId);
    return c.json(okBody(null, '已中止'), 200);
  },
});

mountCrud(router, driveNodeContract,
  { list: listDriveNodes },
  { exclude: ['detail', 'removeBatch'] },
  [
    searchRoute,
    sharedRoute,
    starredRoute,
    recentRoute,
    recycleListRoute,
    recycleRestoreRoute,
    recyclePurgeRoute,
    recycleEmptyRoute,
    createFolderRoute,
    moveRoute,
    copyRoute,
    batchDeleteRoute,
    batchDownloadRoute,
    ensureDirectoriesRoute,
    precheckRoute,
    uploadRoute,
    uploadInitRoute,
    uploadChunkRoute,
    uploadCompleteRoute,
    uploadStatusRoute,
    uploadAbortRoute,
  ],
);

export default router;
