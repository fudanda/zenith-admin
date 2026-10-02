import { eq } from 'drizzle-orm';
import { smsTemplateContract, smsTemplateSchema } from '@arcbase/shared/messaging';
import { smsTemplates } from '../../db/schema';
import { defineCrudService } from '../../lib/crud-service';
import { entityMapper } from '../../lib/entity-map';
import { keywordCondition } from '../../lib/where-helpers';

export const mapSmsTemplate = entityMapper(smsTemplateSchema);

export const smsTemplateService = defineCrudService(smsTemplateContract, {
  table: smsTemplates,
  map: mapSmsTemplate,
  notFound: '短信模板不存在',
  unique: '短信模板编码已存在',
  tenant: true,
  list: (q) => ({
    where: [
      keywordCondition(q.keyword, [smsTemplates.name, smsTemplates.code], 'ilike'),
      q.provider ? eq(smsTemplates.provider, q.provider) : undefined,
      q.status ? eq(smsTemplates.status, q.status) : undefined,
    ],
    orderBy: [smsTemplates.id],
  }),
});

export const {
  list: listSmsTemplates,
  get: getSmsTemplate,
  ensure: ensureSmsTemplateExists,
  create: createSmsTemplate,
  update: updateSmsTemplate,
  remove: deleteSmsTemplate,
} = smsTemplateService;

export const getSmsTemplateBeforeAudit = smsTemplateService.get;
