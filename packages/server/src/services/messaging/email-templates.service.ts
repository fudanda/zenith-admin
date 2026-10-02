import { eq } from 'drizzle-orm';
import { emailTemplateContract, emailTemplateSchema } from '@arcbase/shared/messaging';
import { db } from '../../db';
import { emailTemplates } from '../../db/schema';
import { defineCrudService } from '../../lib/crud-service';
import { entityMapper } from '../../lib/entity-map';
import { tenantScope } from '../../lib/tenant';
import { buildWhere, keywordCondition } from '../../lib/where-helpers';

export const mapEmailTemplate = entityMapper(emailTemplateSchema);

export const emailTemplateService = defineCrudService(emailTemplateContract, {
  table: emailTemplates,
  map: mapEmailTemplate,
  notFound: '邮件模板不存在',
  unique: '邮件模板编码已存在',
  tenant: true,
  list: (q) => ({
    where: [
      keywordCondition(q.keyword, [emailTemplates.name, emailTemplates.code], 'ilike'),
      q.status ? eq(emailTemplates.status, q.status) : undefined,
    ],
    orderBy: [emailTemplates.id],
  }),
});

export const {
  list: listEmailTemplates,
  get: getEmailTemplate,
  ensure: ensureEmailTemplateExists,
  create: createEmailTemplate,
  update: updateEmailTemplate,
  remove: deleteEmailTemplate,
} = emailTemplateService;

export const getEmailTemplateBeforeAudit = emailTemplateService.get;

export async function findEmailTemplateByCode(code: string) {
  const [row] = await db.select().from(emailTemplates).where(buildWhere(eq(emailTemplates.code, code), tenantScope(emailTemplates))).limit(1);
  return row ?? null;
}
