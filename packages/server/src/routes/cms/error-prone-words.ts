import { OpenAPIHono } from '@hono/zod-openapi';
import { cmsErrorProneWordContract } from '@arcbase/shared/cms';
import { validationHook } from '../../lib/openapi-schemas';
import { cmsErrorProneWordService } from '../../services/cms/cms-error-prone-words.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

mountCrud(router, cmsErrorProneWordContract,
  cmsErrorProneWordService,
);

export default router;
