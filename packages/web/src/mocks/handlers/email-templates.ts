import { emailTemplateContract } from '@arcbase/shared/messaging';
import type { EmailTemplate } from '@arcbase/shared/messaging';
import { mock } from '@/mocks/utils/contract';
import { requireItem } from '@/mocks/utils/crud';
import { mockEmailTemplates } from '@/mocks/data/email-templates';
import { mockDateTime } from '@/mocks/utils/date';
import { mockResource } from '@/mocks/utils/resource';

export const emailTemplatesHandlers = [
  ...mockResource(emailTemplateContract, {
    store: mockEmailTemplates,
    notFound: '邮件模板不存在',
    keyword: (item) => [item.name, item.code, item.subject],
    unique: { field: 'code', message: '模板编码已存在' },
    create: (body, id, now): EmailTemplate => ({ id, name: body.name, code: body.code, subject: body.subject, content: body.content, variables: body.variables ?? null, status: body.status, remark: body.remark ?? null, createdAt: now, updatedAt: now }),
    exclude: ['update'],
  }),

  mock(emailTemplateContract.update, ({ params, body, ok }) => {
    const t = requireItem(mockEmailTemplates, params.id, '邮件模板不存在', { status: 404 });
    Object.assign(t, body, { id: t.id, code: t.code, updatedAt: mockDateTime() });
    return ok(t, '更新成功');
  }),
];
