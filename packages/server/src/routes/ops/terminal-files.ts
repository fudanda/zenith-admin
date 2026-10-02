import { OpenAPIHono } from '@hono/zod-openapi';
import { Readable } from 'node:stream';
import { HTTPException } from 'hono/http-exception';
import { terminalFileContract } from '@arcbase/shared/ops';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
import { mapAsyncTask, submitAsyncTask } from '../../lib/task-center';
import { COMPRESS_TASK_TYPE, EXTRACT_TASK_TYPE } from '../../services/ops/terminal-file-tasks';
import {
  listDirectory,
  openDownloadStream,
  saveUploadedFile,
  assertContentLengthWithinLimit,
  listShells,
  readTextFile,
  writeTextFile,
  createEntry,
  deleteEntry,
  renameEntry,
  getRootInfo,
  moveEntry,
  copyEntry,
  chmodEntry,
  computeChecksum,
  computeDirSize,
  searchFiles,
} from '../../services/ops/terminal-files.service';
import { attachmentDisposition } from '../../lib/content-disposition';

/**
 * Web 终端文件浏览/传输路由
 *
 * 权限：`system:terminal:execute`（与 Web 终端一致；终端本身即可访问整个文件系统）。
 */
const terminalFilesRouter = new OpenAPIHono({ defaultHook: validationHook });

const rootInfoRoute = defineContractRoute(terminalFileContract.rootInfo, {
  handler: async (c) => c.json(okBody(await getRootInfo()), 200),
});

const listRoute = defineContractRoute(terminalFileContract.list, {
  handler: async (c) => c.json(okBody(await listDirectory(c.req.valid('query').path)), 200),
});

const downloadRoute = defineContractRoute(terminalFileContract.download, {
  responses: { 404: { content: jsonContent(ErrorResponse), description: '文件不存在' } },
  handler: async (c) => {
    const { path: filePath } = c.req.valid('query');
    const { stream, fileName } = await openDownloadStream(filePath);
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': attachmentDisposition(fileName),
        'X-Content-Type-Options': 'nosniff',
      },
    });
  },
});

const uploadRoute = defineContractRoute(terminalFileContract.upload, {
  responses: { 400: { content: jsonContent(ErrorResponse), description: '未选择文件或目标无效' } },
  handler: async (c) => {
    // 预检放在 parseBody 之前：Hono 会把整个请求体读入内存后才交给业务代码
    await assertContentLengthWithinLimit(c.req.header('content-length'));
    const body = await c.req.parseBody();
    const dirPath = typeof body.path === 'string' ? body.path : '';
    const file = body.file;
    if (!(file instanceof File)) {
      throw new HTTPException(400, { message: '未选择文件' });
    }
    const entry = await saveUploadedFile(dirPath, file);
    return c.json(okBody(entry, '上传成功'), 200);
  },
});

const shellsRoute = defineContractRoute(terminalFileContract.shells, {
  handler: async (c) => c.json(okBody(await listShells()), 200),
});

const readContentRoute = defineContractRoute(terminalFileContract.content, {
  handler: async (c) => c.json(okBody(await readTextFile(c.req.valid('query').path)), 200),
});

const writeContentRoute = defineContractRoute(terminalFileContract.saveContent, {
  responses: { 409: { content: jsonContent(ErrorResponse), description: '文件已被他人修改' } },
  handler: async (c) => {
    const { path: filePath, content, baseEtag } = c.req.valid('json');
    return c.json(okBody(await writeTextFile(filePath, content, baseEtag), '保存成功'), 200);
  },
});

const createEntryRoute = defineContractRoute(terminalFileContract.create, {
  handler: async (c) => {
    const { path: targetPath, type } = c.req.valid('json');
    return c.json(okBody(await createEntry(targetPath, type), '创建成功'), 200);
  },
});

const renameEntryRoute = defineContractRoute(terminalFileContract.rename, {
  handler: async (c) => {
    const { from, to } = c.req.valid('json');
    return c.json(okBody(await renameEntry(from, to), '操作成功'), 200);
  },
});

const deleteEntryRoute = defineContractRoute(terminalFileContract.remove, {
  handler: async (c) => {
    await deleteEntry(c.req.valid('query').path);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const moveEntryRoute = defineContractRoute(terminalFileContract.move, {
  handler: async (c) => {
    const { from, to } = c.req.valid('json');
    return c.json(okBody(await moveEntry(from, to), '移动成功'), 200);
  },
});

const copyEntryRoute = defineContractRoute(terminalFileContract.copy, {
  handler: async (c) => {
    const { from, to } = c.req.valid('json');
    return c.json(okBody(await copyEntry(from, to), '复制成功'), 200);
  },
});

const compressRoute = defineContractRoute(terminalFileContract.compress, {
  handler: async (c) => {
    const { paths, destPath } = c.req.valid('json');
    const task = await submitAsyncTask({
      taskType: COMPRESS_TASK_TYPE,
      title: `压缩 ${paths.length} 项到 ${destPath.split(/[\\/]/).pop() ?? destPath}`,
      payload: { paths, destPath },
    });
    return c.json(okBody(mapAsyncTask(task), '压缩任务已提交'), 200);
  },
});

const chmodRoute = defineContractRoute(terminalFileContract.chmod, {
  handler: async (c) => {
    const { path: filePath, mode } = c.req.valid('json');
    await chmodEntry(filePath, mode);
    return c.json(okBody(null, '权限已修改'), 200);
  },
});

const extractRoute = defineContractRoute(terminalFileContract.extract, {
  handler: async (c) => {
    const { path: archivePath, destPath } = c.req.valid('json');
    const task = await submitAsyncTask({
      taskType: EXTRACT_TASK_TYPE,
      title: `解压 ${archivePath.split(/[\\/]/).pop() ?? archivePath}`,
      payload: { path: archivePath, destDir: destPath },
    });
    return c.json(okBody(mapAsyncTask(task), '解压任务已提交'), 200);
  },
});

const checksumRoute = defineContractRoute(terminalFileContract.checksum, {
  handler: async (c) => {
    const { path: filePath, algo } = c.req.valid('query');
    return c.json(okBody(await computeChecksum(filePath, algo)), 200);
  },
});

const searchRoute = defineContractRoute(terminalFileContract.search, {
  handler: async (c) => {
    const { dir, keyword } = c.req.valid('query');
    return c.json(okBody(await searchFiles(dir, keyword)), 200);
  },
});

const dirSizeRoute = defineContractRoute(terminalFileContract.dirSize, {
  handler: async (c) => {
    const { path: dirPath } = c.req.valid('query');
    return c.json(okBody(await computeDirSize(dirPath)), 200);
  },
});

terminalFilesRouter.openapiRoutes([
  rootInfoRoute,
  listRoute,
  downloadRoute,
  uploadRoute,
  shellsRoute,
  readContentRoute,
  writeContentRoute,
  createEntryRoute,
  renameEntryRoute,
  deleteEntryRoute,
  moveEntryRoute,
  copyEntryRoute,
  compressRoute,
  chmodRoute,
  extractRoute,
  checksumRoute,
  searchRoute,
  dirSizeRoute,
] as const);

export default terminalFilesRouter;
