import { OpenAPIHono } from '@hono/zod-openapi';
import { driveShareLinkContract } from '@arcbase/shared/drive';
import { setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  deleteDriveShareLink,
  ensureDriveShareShortLink,
  getShareLinkBeforeAudit,
  listCollectSubmissions,
  listMyShareLinks,
  listShareAccessLogs,
  revokeDriveShareLink,
  updateDriveShareLink,
} from '../../services/drive/drive-share.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

const updateRoute = defineContractRoute(driveShareLinkContract.update, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getShareLinkBeforeAudit(id));
    return c.json(okBody(await updateDriveShareLink(id, c.req.valid('json')), '已更新'), 200);
  },
});

const revokeRoute = defineContractRoute(driveShareLinkContract.revoke, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getShareLinkBeforeAudit(id));
    await revokeDriveShareLink(id);
    setAuditAfterData(c, await getShareLinkBeforeAudit(id));
    return c.json(okBody(null, '已撤销'), 200);
  },
});

const deleteRoute = defineContractRoute(driveShareLinkContract.remove, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getShareLinkBeforeAudit(id));
    await deleteDriveShareLink(id);
    return c.json(okBody(null, '已删除'), 200);
  },
});

const accessLogsRoute = defineContractRoute(driveShareLinkContract.accessLogs, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await listShareAccessLogs(id, c.req.valid('query'))), 200);
  },
});

const submissionsRoute = defineContractRoute(driveShareLinkContract.submissions, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await listCollectSubmissions(id, c.req.valid('query'))), 200);
  },
});

const shortLinkRoute = defineContractRoute(driveShareLinkContract.shortLink, {
  handler: async (c) => c.json(okBody(await ensureDriveShareShortLink(c.req.valid('param').id), '短链已生成'), 200),
});

mountCrud(router, driveShareLinkContract,
  { list: listMyShareLinks },
  { exclude: ['update', 'remove'] },
  [updateRoute, revokeRoute, deleteRoute, accessLogsRoute, submissionsRoute, shortLinkRoute],
);

export default router;
