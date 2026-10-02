import { OpenAPIHono } from '@hono/zod-openapi';
import { emailTemplateContract } from '@arcbase/shared/messaging';
import { validationHook } from '../../lib/openapi-schemas';
import { emailTemplateService } from '../../services/messaging/email-templates.service';
import { mountCrud } from '../_crud';

const emailTemplatesRouter = new OpenAPIHono({ defaultHook: validationHook });

mountCrud(emailTemplatesRouter, emailTemplateContract,
  emailTemplateService,
);

export default emailTemplatesRouter;
