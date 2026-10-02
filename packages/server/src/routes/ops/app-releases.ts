/**
 * 应用版本管理（管理侧 API）。
 *
 * 应用 / 版本 / 制品 CRUD、发布状态机（publish / revoke）、灰度调整与升级看板统计、统一设备中心。
 * 五组子资源各自独立挂载在应用版本资源根下的静态前缀（apps / releases / artifacts / devices / stats），
 * 见 routes/ops/index.ts。公开侧（客户端检查更新 / 制品分发）在 public-app-releases.ts，不要混入本文件。
 */
import { OpenAPIHono, z } from '@hono/zod-openapi';
import {
  APP_ARCHES,
  APP_FILE_ARTIFACT_KINDS,
  APP_PLATFORMS,
  appArtifactContract,
  appReleaseContract,
  appReleaseStatsContract,
  clientAppContract,
  clientDeviceContract,
} from '@arcbase/shared/ops';
import { setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, errBody, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
import {
  abortArtifactUpload,
  addExternalArtifact,
  addFileArtifact,
  completeArtifactUpload,
  createAppRelease,
  createClientApp,
  deleteAppArtifact,
  deleteAppRelease,
  deleteClientApp,
  getAppArtifactBeforeAudit,
  getAppRelease,
  getAppReleaseBeforeAudit,
  getAppReleaseStats,
  getArtifactUploadStatus,
  getClientAppBeforeAudit,
  initArtifactUpload,
  listAllClientApps,
  listAppReleases,
  listClientApps,
  publishAppRelease,
  revokeAppRelease,
  setAppReleaseRollout,
  updateAppRelease,
  updateClientApp,
  uploadArtifactChunk,
} from '../../services/ops/app-releases.service';
import {
  adminUnbindDevicePush,
  deleteClientDevice,
  getClientDeviceBeforeAudit,
  listClientDevices,
} from '../../services/ops/client-devices.service';
import { mountCrud } from '../_crud';

const notFoundResponse = { 404: { content: jsonContent(ErrorResponse), description: '不存在' } } as const;

// ─── 应用 ────────────────────────────────────────────────────────────────────

export const clientAppsRouter = new OpenAPIHono({ defaultHook: validationHook });

const allAppsRoute = defineContractRoute(clientAppContract.all, {
  handler: async (c) => c.json(okBody(await listAllClientApps()), 200),
});

// 静态 /all 先于 /{id}
mountCrud(clientAppsRouter, clientAppContract,
  {
    list: listClientApps,
    get: getClientAppBeforeAudit,
    create: createClientApp,
    update: updateClientApp,
    remove: deleteClientApp,
  },
  {
    responses: { update: notFoundResponse, remove: notFoundResponse },
  },
  [allAppsRoute],
);

// ─── 版本 ────────────────────────────────────────────────────────────────────

export const appReleasesRouter = new OpenAPIHono({ defaultHook: validationHook });

const publishReleaseRoute = defineContractRoute(appReleaseContract.publish, {
  responses: notFoundResponse,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getAppReleaseBeforeAudit(id));
    return c.json(okBody(await publishAppRelease(id), '发布成功'), 200);
  },
});

const revokeReleaseRoute = defineContractRoute(appReleaseContract.revoke, {
  responses: notFoundResponse,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getAppReleaseBeforeAudit(id));
    return c.json(okBody(await revokeAppRelease(id), '撤回成功'), 200);
  },
});

const rolloutRoute = defineContractRoute(appReleaseContract.rollout, {
  responses: notFoundResponse,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getAppReleaseBeforeAudit(id));
    const { rolloutPercent } = c.req.valid('json');
    return c.json(okBody(await setAppReleaseRollout(id, rolloutPercent), '调整成功'), 200);
  },
});

/** multipart 字段校验（文件本体由 parseBody 提取） */
const uploadArtifactFieldsSchema = z.object({
  platform: z.enum(APP_PLATFORMS),
  arch: z.enum(APP_ARCHES).default('x64'),
  kind: z.enum(APP_FILE_ARTIFACT_KINDS).default('installer'),
});

const uploadArtifactRoute = defineContractRoute(appReleaseContract.uploadArtifact, {
  responses: { 404: { content: jsonContent(ErrorResponse), description: '版本不存在' } },
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const body = await c.req.parseBody();
    const parsed = uploadArtifactFieldsSchema.safeParse({
      platform: body.platform,
      arch: body.arch || undefined,
      kind: body.kind || undefined,
    });
    if (!parsed.success) return c.json(errBody(parsed.error.issues[0]?.message ?? '制品参数不合法', 400), 400);
    if (!(body.file instanceof File)) return c.json(errBody('请选择要上传的制品文件', 400), 400);
    const artifact = await addFileArtifact(id, parsed.data, body.file);
    return c.json(okBody(artifact, '上传成功'), 200);
  },
});

const externalArtifactRoute = defineContractRoute(appReleaseContract.addExternalArtifact, {
  responses: { 404: { content: jsonContent(ErrorResponse), description: '版本不存在' } },
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await addExternalArtifact(id, c.req.valid('json')), '添加成功'), 200);
  },
});

// 制品分片上传：会话归属校验在 service（绑定表按发起人 + 版本过滤），路由只做协议边界
const artifactUploadInitRoute = defineContractRoute(appReleaseContract.uploadInit, {
  responses: { 404: { content: jsonContent(ErrorResponse), description: '版本不存在' } },
  handler: async (c) => c.json(okBody(await initArtifactUpload(c.req.valid('param').id, c.req.valid('json'))), 200),
});

const artifactUploadChunkRoute = defineContractRoute(appReleaseContract.uploadChunk, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const body = await c.req.parseBody();
    const uploadId = String(body.uploadId ?? '');
    const index = Number(body.index);
    const chunk = body.chunk;
    if (!uploadId || !Number.isFinite(index) || !(chunk instanceof File)) {
      return c.json(errBody('分片参数不完整', 400), 400);
    }
    return c.json(okBody(await uploadArtifactChunk(id, uploadId, index, chunk)), 200);
  },
});

const artifactUploadCompleteRoute = defineContractRoute(appReleaseContract.uploadComplete, {
  responses: { 400: { content: jsonContent(ErrorResponse), description: '分片不完整或校验失败' } },
  handler: async (c) => c.json(okBody(await completeArtifactUpload(c.req.valid('param').id, c.req.valid('json').uploadId), '上传成功'), 200),
});

const artifactUploadStatusRoute = defineContractRoute(appReleaseContract.uploadStatus, {
  responses: { 404: { content: jsonContent(ErrorResponse), description: '会话不存在' } },
  handler: async (c) => {
    const { id, uploadId } = c.req.valid('param');
    return c.json(okBody(await getArtifactUploadStatus(id, uploadId)), 200);
  },
});

const artifactUploadAbortRoute = defineContractRoute(appReleaseContract.uploadAbort, {
  handler: async (c) => {
    const { id, uploadId } = c.req.valid('param');
    await abortArtifactUpload(id, uploadId);
    return c.json(okBody(null, '已中止'), 200);
  },
});

mountCrud(appReleasesRouter, appReleaseContract,
  {
    list: listAppReleases,
    get: getAppRelease,
    create: createAppRelease,
    update: updateAppRelease,
    remove: deleteAppRelease,
  },
  {
    responses: { detail: notFoundResponse, update: notFoundResponse, remove: notFoundResponse },
  },
  [
    publishReleaseRoute,
    revokeReleaseRoute,
    rolloutRoute,
    uploadArtifactRoute,
    externalArtifactRoute,
    artifactUploadInitRoute,
    artifactUploadChunkRoute,
    artifactUploadCompleteRoute,
    artifactUploadStatusRoute,
    artifactUploadAbortRoute,
  ],
);

// ─── 制品 ────────────────────────────────────────────────────────────────────

export const appArtifactsRouter = new OpenAPIHono({ defaultHook: validationHook });

mountCrud(appArtifactsRouter, appArtifactContract,
  { get: getAppArtifactBeforeAudit, remove: deleteAppArtifact },
  { responses: { remove: notFoundResponse } },
);

// ─── 看板统计 ────────────────────────────────────────────────────────────────

export const appReleaseStatsRouter = new OpenAPIHono({ defaultHook: validationHook });

const statsRoute = defineContractRoute(appReleaseStatsContract.stats, {
  handler: async (c) => {
    const { appId, days } = c.req.valid('query');
    return c.json(okBody(await getAppReleaseStats(appId, days)), 200);
  },
});

appReleaseStatsRouter.openapiRoutes([statsRoute] as const);

// ─── 设备中心（管理端）───────────────────────────────────────────────────────

export const clientDevicesRouter = new OpenAPIHono({ defaultHook: validationHook });

const unbindDeviceRoute = defineContractRoute(clientDeviceContract.unbind, {
  responses: notFoundResponse,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getClientDeviceBeforeAudit(id));
    await adminUnbindDevicePush(id);
    return c.json(okBody(null, '解绑成功'), 200);
  },
});

mountCrud(clientDevicesRouter, clientDeviceContract,
  { list: listClientDevices, get: getClientDeviceBeforeAudit, remove: deleteClientDevice },
  { responses: { remove: notFoundResponse } },
  [unbindDeviceRoute],
);
