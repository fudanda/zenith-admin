import { OpenAPIHono } from '@hono/zod-openapi';
import { reportFolderContract } from '@arcbase/shared/report';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  createReportFolder,
  deleteReportFolder,
  getReportFolder,
  listReportFolderTree,
  moveReportFolder,
  updateReportFolder,
} from '../../services/report/report-folder.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

const treeRoute = defineContractRoute(reportFolderContract.tree, {
  handler: async (c) => c.json(okBody(await listReportFolderTree(c.req.valid('query').resourceType)), 200),
});
const moveRoute = defineContractRoute(reportFolderContract.move, {
  handler: async (c) => c.json(okBody(await moveReportFolder(c.req.valid('param').id, c.req.valid('json')), '移动成功'), 200),
});

mountCrud(router, reportFolderContract,
  { get: getReportFolder, create: createReportFolder, update: updateReportFolder, remove: deleteReportFolder },
  {},
  [treeRoute, moveRoute],
);

export default router;
