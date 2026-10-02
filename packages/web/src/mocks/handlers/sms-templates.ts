import { smsTemplateContract } from '@arcbase/shared/messaging';
import type { SmsTemplate } from '@arcbase/shared/messaging';
import { mock } from '@/mocks/utils/contract';
import { requireItem } from '@/mocks/utils/crud';
import { mockSmsTemplates } from '@/mocks/data/sms-templates';
import { mockDateTime } from '@/mocks/utils/date';
import { mockResource } from '@/mocks/utils/resource';

export const smsTemplatesHandlers = [
  ...mockResource(smsTemplateContract, {
    store: mockSmsTemplates,
    notFound: '短信模板不存在',
    keyword: (item) => [item.name, item.code, item.templateCode],
    unique: { field: 'code', message: '模板编码已存在' },
    create: (body, id, now): SmsTemplate => ({ id, name: body.name, code: body.code, templateCode: body.templateCode, signName: body.signName ?? null, content: body.content, variables: body.variables ?? null, provider: body.provider, status: body.status, remark: body.remark ?? null, createdAt: now, updatedAt: now }),
    exclude: ['update'],
  }),

  mock(smsTemplateContract.update, ({ params, body, ok }) => {
    const t = requireItem(mockSmsTemplates, params.id, '短信模板不存在', { status: 404 });
    Object.assign(t, body, { id: t.id, code: t.code, updatedAt: mockDateTime() });
    return ok(t, '更新成功');
  }),
];
