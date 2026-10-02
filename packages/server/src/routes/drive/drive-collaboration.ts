import { OpenAPIHono } from '@hono/zod-openapi';
import { driveCollaborationContract } from '@arcbase/shared/drive';
import { setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { getDriveNodeProfile, getDriveSubscription, listDriveSpaceActivities, saveDriveNodeProfile, setDriveSubscription } from '../../services/drive/drive-collaboration.service';
import { updateDriveNodeComment } from '../../services/drive/drive-extras.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

router.openapiRoutes([
  defineContractRoute(driveCollaborationContract.profile, {
    handler: async (c) => c.json(okBody(await getDriveNodeProfile(c.req.valid('param').id)), 200),
  }),
  defineContractRoute(driveCollaborationContract.saveProfile, {
    handler: async (c) => {
      const { id } = c.req.valid('param');
      setAuditBeforeData(c, await getDriveNodeProfile(id));
      return c.json(okBody(await saveDriveNodeProfile(id, c.req.valid('json'))), 200);
    },
  }),
  defineContractRoute(driveCollaborationContract.subscription, {
    handler: async (c) => c.json(okBody(await getDriveSubscription(c.req.valid('param').id)), 200),
  }),
  defineContractRoute(driveCollaborationContract.subscribe, {
    handler: async (c) => c.json(okBody(await setDriveSubscription(c.req.valid('param').id, c.req.valid('json').subscribed)), 200),
  }),
  defineContractRoute(driveCollaborationContract.editComment, {
    handler: async (c) => {
      const { id, commentId } = c.req.valid('param');
      return c.json(okBody(await updateDriveNodeComment(id, commentId, c.req.valid('json'))), 200);
    },
  }),
  defineContractRoute(driveCollaborationContract.spaceActivities, {
    handler: async (c) => c.json(okBody(await listDriveSpaceActivities(c.req.valid('param').id, c.req.valid('query'))), 200),
  }),
] as const);

export default router;
