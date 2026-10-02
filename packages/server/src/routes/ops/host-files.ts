import { OpenAPIHono } from '@hono/zod-openapi';
import { Readable } from 'node:stream';
import { HTTPException } from 'hono/http-exception';
import { hostFileContract } from '@arcbase/shared/ops';
import { assertRemoteHostAccess } from '../../lib/host-access';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
import {
  hostFileChmod,
  hostFileCreate,
  hostFileDelete,
  hostFileDownload,
  hostFileHome,
  hostFileList,
  hostFileReadText,
  hostFileRename,
  hostFileUpload,
  hostFileWriteText,
} from '../../services/ops/host-files.service';
import { assertContentLengthWithinLimit } from '../../services/ops/terminal-files.service';
import { attachmentDisposition } from '../../lib/content-disposition';

const router = new OpenAPIHono({ defaultHook: validationHook });

const homeRoute = defineContractRoute(hostFileContract.home, {
  handler: async (c) => {
    const { hostId } = c.req.valid('param');
    await assertRemoteHostAccess(c, hostId);
    return c.json(okBody(await hostFileHome(hostId)), 200);
  },
});

const listRoute = defineContractRoute(hostFileContract.list, {
  handler: async (c) => {
    const { hostId } = c.req.valid('param');
    await assertRemoteHostAccess(c, hostId);
    return c.json(okBody(await hostFileList(hostId, c.req.valid('query').path)), 200);
  },
});

const readRoute = defineContractRoute(hostFileContract.content, {
  handler: async (c) => {
    const { hostId } = c.req.valid('param');
    await assertRemoteHostAccess(c, hostId);
    return c.json(okBody(await hostFileReadText(hostId, c.req.valid('query').path)), 200);
  },
});

const writeRoute = defineContractRoute(hostFileContract.saveContent, {
  responses: { 409: { content: jsonContent(ErrorResponse), description: '文件已被修改' } },
  handler: async (c) => {
    const { hostId } = c.req.valid('param');
    await assertRemoteHostAccess(c, hostId);
    const body = c.req.valid('json');
    return c.json(okBody(await hostFileWriteText(hostId, body.path, body.content, body.baseEtag), '保存成功'), 200);
  },
});

const createEntryRoute = defineContractRoute(hostFileContract.create, {
  handler: async (c) => {
    const { hostId } = c.req.valid('param');
    await assertRemoteHostAccess(c, hostId);
    const body = c.req.valid('json');
    return c.json(okBody(await hostFileCreate(hostId, body.path, body.type), '创建成功'), 200);
  },
});

const renameRoute = defineContractRoute(hostFileContract.rename, {
  handler: async (c) => {
    const { hostId } = c.req.valid('param');
    await assertRemoteHostAccess(c, hostId);
    const body = c.req.valid('json');
    return c.json(okBody(await hostFileRename(hostId, body.from, body.to), '操作成功'), 200);
  },
});

const deleteRoute = defineContractRoute(hostFileContract.remove, {
  handler: async (c) => {
    const { hostId } = c.req.valid('param');
    await assertRemoteHostAccess(c, hostId);
    await hostFileDelete(hostId, c.req.valid('query').path);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const chmodRoute = defineContractRoute(hostFileContract.chmod, {
  handler: async (c) => {
    const { hostId } = c.req.valid('param');
    await assertRemoteHostAccess(c, hostId);
    const body = c.req.valid('json');
    await hostFileChmod(hostId, body.path, body.mode);
    return c.json(okBody(null, '权限已修改'), 200);
  },
});

const downloadRoute = defineContractRoute(hostFileContract.download, {
  handler: async (c) => {
    const { hostId } = c.req.valid('param');
    await assertRemoteHostAccess(c, hostId);
    const file = await hostFileDownload(hostId, c.req.valid('query').path);
    return new Response(Readable.toWeb(file.stream) as ReadableStream, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(file.size),
        'Content-Disposition': attachmentDisposition(file.fileName),
        'X-Content-Type-Options': 'nosniff',
      },
    });
  },
});

const uploadRoute = defineContractRoute(hostFileContract.upload, {
  handler: async (c) => {
    const { hostId } = c.req.valid('param');
    await assertRemoteHostAccess(c, hostId);
    await assertContentLengthWithinLimit(c.req.header('content-length'));
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) throw new HTTPException(400, { message: '未选择文件' });
    return c.json(okBody(await hostFileUpload(hostId, typeof body.path === 'string' ? body.path : '/', file), '上传成功'), 200);
  },
});

router.openapiRoutes([
  homeRoute, listRoute, readRoute, writeRoute, createEntryRoute,
  renameRoute, deleteRoute, chmodRoute, downloadRoute, uploadRoute,
] as const);

export default router;
