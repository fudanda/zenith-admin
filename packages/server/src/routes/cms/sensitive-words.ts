import { OpenAPIHono } from '@hono/zod-openapi';
import { cmsSensitiveWordContract } from '@arcbase/shared/cms';
import { validationHook } from '../../lib/openapi-schemas';
import { cmsSensitiveWordService } from '../../services/cms/cms-sensitive-words.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

mountCrud(router, cmsSensitiveWordContract,
  cmsSensitiveWordService,
);

export default router;
