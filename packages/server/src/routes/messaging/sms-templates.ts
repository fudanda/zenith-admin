import { OpenAPIHono } from '@hono/zod-openapi';
import { smsTemplateContract } from '@arcbase/shared/messaging';
import { validationHook } from '../../lib/openapi-schemas';
import { smsTemplateService } from '../../services/messaging/sms-templates.service';
import { mountCrud } from '../_crud';

const smsTemplatesRouter = new OpenAPIHono({ defaultHook: validationHook });

mountCrud(smsTemplatesRouter, smsTemplateContract,
  smsTemplateService,
);

export default smsTemplatesRouter;
