import { OpenAPIHono } from '@hono/zod-openapi';
import { checkinMilestoneContract } from '@arcbase/shared/member';
import { validationHook } from '../../lib/openapi-schemas';
import {
  listCheckinMilestones,
  createCheckinMilestone,
  updateCheckinMilestone,
  deleteCheckinMilestone,
  ensureMilestoneExists,
} from '../../services/member/checkin-milestones.service';
import { mountCrud } from '../_crud';

const checkinMilestonesRouter = new OpenAPIHono({ defaultHook: validationHook });

mountCrud(checkinMilestonesRouter, checkinMilestoneContract,
  {
    create: createCheckinMilestone,
    list: listCheckinMilestones,
    get: ensureMilestoneExists,
    update: updateCheckinMilestone,
    remove: deleteCheckinMilestone,
  },
);

export default checkinMilestonesRouter;
