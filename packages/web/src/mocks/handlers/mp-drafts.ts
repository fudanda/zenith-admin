import { mpDraftContract, type MpDraft } from '@arcbase/shared/mp';
import { mock } from '@/mocks/utils/contract';
import { requireItem } from '@/mocks/utils/crud';
import { mockMpDrafts } from '@/mocks/data/mp-drafts';
import { mockDateTime } from '@/mocks/utils/date';
import { filterByKeyword } from '@/mocks/utils/filter';
import { mockResource } from '@/mocks/utils/resource';

export const mpDraftsHandlers = [
  mock(mpDraftContract.list, ({ query, ok, paginate }) => {
    const filtered = filterByKeyword(mockMpDrafts, query.keyword, [(d) => d.title]).filter((d) => d.accountId === query.accountId);
    return ok(paginate([...filtered].sort((a, b) => b.id - a.id)));
  }),
  ...mockResource(mpDraftContract, {
    store: mockMpDrafts,
    notFound: '图文草稿不存在',
    create: (body, id, now): MpDraft => ({ id, accountId: body.accountId, title: body.articles[0]?.title ?? '未命名图文', articles: body.articles, wechatMediaId: null, status: 'draft', createdAt: now, updatedAt: now }),
    exclude: ['list', 'update'],
  }),

  mock(mpDraftContract.update, ({ params, body, ok }) => {
    const d = requireItem(mockMpDrafts, params.id, '图文草稿不存在', { status: 404 });
    d.articles = body.articles;
    d.title = body.articles[0]?.title ?? '未命名图文';
    d.status = 'draft';
    d.wechatMediaId = null;
    d.updatedAt = mockDateTime();
    return ok(d, '更新成功');
  }),

  mock(mpDraftContract.push, ({ params, ok }) => {
    const d = requireItem(mockMpDrafts, params.id, '图文草稿不存在', { status: 404 });
    d.status = 'published';
    d.wechatMediaId = `mock_draft_${d.id}`;
    d.updatedAt = mockDateTime();
    return ok(d, '推送成功');
  }),
];
