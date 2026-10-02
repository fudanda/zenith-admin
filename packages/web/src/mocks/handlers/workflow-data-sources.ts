import { workflowDataSourceContract } from '@arcbase/shared/workflow';
import type { WorkflowDataSource } from '@arcbase/shared/workflow';
import { mock } from '@/mocks/utils/contract';
import { requireItem } from '@/mocks/utils/crud';
import { mockWorkflowDataSources, MOCK_DATA_SOURCE_OPTIONS } from '@/mocks/data/workflow-data-sources';
import { mockDateTime } from '@/mocks/utils/date';
import { filterByKeyword } from '@/mocks/utils/filter';
import { mockResource } from '@/mocks/utils/resource';

export const workflowDataSourcesHandlers = [
  // 代理拉取选项（demo 返回示例数据 + 关键词过滤）
  mock(workflowDataSourceContract.options, ({ query, ok }) => {
    const keyword = query.keyword ?? '';
    const list = keyword
      ? MOCK_DATA_SOURCE_OPTIONS.filter((o) => o.label.toLowerCase().includes(keyword.toLowerCase()))
      : MOCK_DATA_SOURCE_OPTIONS;
    return ok(list);
  }),

  // 按选项值取完整记录（demo 按选项合成示例记录）
  mock(workflowDataSourceContract.record, ({ query, ok }) => {
    const hit = MOCK_DATA_SOURCE_OPTIONS.find((o) => o.value === query.value);
    const record = hit ? { value: hit.value, label: hit.label, code: hit.value, name: hit.label } : null;
    return ok(record);
  }),

  mock(workflowDataSourceContract.list, ({ query, ok, paginate }) => {
    const keyword = query.keyword ?? '';
    let list = [...mockWorkflowDataSources];
    if (keyword) list = filterByKeyword(list, keyword, [(x) => x.name, (x) => x.url]);
    if (query.status) list = list.filter((x) => x.status === query.status);
    return ok(paginate(list));
  }),
  ...mockResource(workflowDataSourceContract, {
    store: mockWorkflowDataSources,
    notFound: '数据源不存在',
    create: (body, id, now): WorkflowDataSource => ({ id, name: body.name, method: body.method, url: body.url, headers: body.headers ?? null, itemsPath: body.itemsPath ?? null, valueField: body.valueField, labelField: body.labelField, keywordParam: body.keywordParam ?? null, status: body.status, remark: body.remark ?? null, createdAt: now, updatedAt: now }),
    exclude: ['list', 'update'],
  }),

  mock(workflowDataSourceContract.update, ({ params, body, ok }) => {
    const item = requireItem(mockWorkflowDataSources, params.id, '数据源不存在', { status: 404 });
    Object.assign(item, { ...body, updatedAt: mockDateTime() });
    return ok(item, '更新成功');
  }),
];
