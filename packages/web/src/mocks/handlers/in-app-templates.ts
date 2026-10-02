import { inAppTemplateContract } from '@arcbase/shared/messaging';
import type { InAppTemplate } from '@arcbase/shared/messaging';
import { mock } from '@/mocks/utils/contract';
import { requireItem } from '@/mocks/utils/crud';
import { mockInAppTemplates } from '@/mocks/data/in-app-templates';
import { mockDateTime } from '@/mocks/utils/date';
import { mockResource } from '@/mocks/utils/resource';

export const inAppTemplatesHandlers = [
  ...mockResource(inAppTemplateContract, {
    store: mockInAppTemplates,
    notFound: '站内信模板不存在',
    keyword: (item) => [item.name, item.code, item.title],
    unique: { field: 'code', message: '模板编码已存在' },
    create: (body, id, now): InAppTemplate => ({ id, name: body.name, code: body.code, title: body.title, content: body.content, type: body.type, variables: body.variables ?? null, status: body.status, remark: body.remark ?? null, createdAt: now, updatedAt: now }),
    exclude: ['update'],
  }),

  mock(inAppTemplateContract.update, ({ params, body, ok }) => {
    const t = requireItem(mockInAppTemplates, params.id, '站内信模板不存在', { status: 404 });
    Object.assign(t, body, { id: t.id, code: t.code, updatedAt: mockDateTime() });
    return ok(t, '更新成功');
  }),
];
