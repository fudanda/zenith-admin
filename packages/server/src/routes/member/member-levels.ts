import { OpenAPIHono } from '@hono/zod-openapi';
import { memberLevelContract } from '@arcbase/shared/member';
import { validationHook } from '../../lib/openapi-schemas';
import {
  listLevels,
  getLevel,
  createLevel,
  updateLevel,
  deleteLevel,
} from '../../services/member/member-levels.service';
import { mountCrud } from '../_crud';

const levelsRouter = new OpenAPIHono({ defaultHook: validationHook });

mountCrud(levelsRouter, memberLevelContract,
  { get: getLevel, create: createLevel, update: updateLevel, remove: deleteLevel, list: listLevels },
);

export default levelsRouter;
