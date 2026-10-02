import { useMemo } from 'react';
import { Tag, Toast } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { useNavigate } from 'react-router-dom';
import { WORKFLOW_FORM_STATUS_LABELS, type WorkflowForm, type WorkflowFormStatus } from '@arcbase/shared/workflow';
import { usePermission } from '@/hooks/usePermission';
import { useDictItems } from '@/hooks/useDictItems';
import { useWorkflowCategories } from '@/hooks/useWorkflowCategories';
import ConfigurableTable from '@/components/ConfigurableTable';
import {
  useDeleteWorkflowForm,
  useDuplicateWorkflowForm,
  useWorkflowFormList,
  workflowFormKeys,
} from '@/hooks/queries/workflow-forms';
import { CreateButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import { ListSearchToolbar, useCrudOperationColumn } from '@/components/list-page';
import { EMPTY_PLACEHOLDER, dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { useListPage } from '@/hooks/useListPage';

type StatusFilter = WorkflowFormStatus | undefined;
type TagColor = 'green' | 'grey';

interface SearchParams {
  keyword: string;
  status: StatusFilter;
  categoryId: number | undefined;
}

const defaultSearchParams: SearchParams = { keyword: '', status: undefined, categoryId: undefined };

const STATUS_COLORS: Record<WorkflowFormStatus, TagColor> = {
  enabled: 'green',
  disabled: 'grey',
};

function toStatus(value: unknown): StatusFilter {
  return value === 'enabled' || value === 'disabled' ? value : undefined;
}

export default function WorkflowFormsPage() {
  const { hasPermission } = usePermission();
  const navigate = useNavigate();
  const { items: statusItems } = useDictItems('common_status');
  const {
    bind,
    bindKeyword,
    handleSearch,
    handleReset,
    tableProps,
  } = useListPage({
    defaults: defaultSearchParams,
    listKey: workflowFormKeys.lists,
    useList: useWorkflowFormList,
    toQuery: (s) => ({ keyword: s.keyword, status: s.status, categoryId: s.categoryId }),
  });
  const { categories } = useWorkflowCategories();

  const deleteMutation = useDeleteWorkflowForm();
  const duplicateMutation = useDuplicateWorkflowForm();

  const categoryOptions = useMemo(
    () => categories.map((category) => ({ label: category.name, value: category.id })),
    [categories],
  );

  const categoryNameMap = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  );

  const handleDuplicate = async (id: number) => {
    try {
      await duplicateMutation.mutateAsync({ params: { id } });
      Toast.success('复制成功');
    } catch (err) {
      Toast.error(err instanceof Error ? err.message : '复制失败');
    }
  };

  const operationColumn = useCrudOperationColumn<WorkflowForm>({
    permissions: { edit: 'workflow:form:edit', remove: 'workflow:form:delete' },
    edit: (record) => navigate(`/workflow/forms/designer?id=${record.id}`),
    remove: (record) => deleteMutation.mutateAsync({ params: { id: record.id } }),
    title: '确定要删除该表单吗？',
    disabled: { remove: (record) => (record.usageCount ?? 0) > 0, reason: (record) => `该表单正被 ${record.usageCount} 个流程引用，解除引用后才能删除` },
    extraBetween: (record) => [
      {
        key: 'duplicate',
        label: '复制',
        hidden: !hasPermission('workflow:form:create'),
        onClick: () => void handleDuplicate(record.id),
      },
    ],
    width: 210,
    desktopInlineKeys: ['edit', 'duplicate', 'delete'],
  });

  const columns: ColumnProps<WorkflowForm>[] = [
    {
      title: '表单名称',
      dataIndex: 'name',
      minWidth: 220,
    },
    {
      title: '标识',
      dataIndex: 'code',
      width: 220,
      render: renderEllipsis,
    },
    {
      title: '分类',
      dataIndex: 'categoryName',
      width: 140,
      render: (_value: unknown, record: WorkflowForm) => (
        record.categoryName || (record.categoryId === null ? null : categoryNameMap.get(record.categoryId)) || EMPTY_PLACEHOLDER
      ),
    },
    {
      title: '字段数',
      dataIndex: 'schema',
      width: 90,
      render: (_value: unknown, record: WorkflowForm) => record.schema?.fields?.length ?? 0,
    },
    {
      title: '引用数',
      align: 'right',
      dataIndex: 'usageCount',
      width: 90,
      render: (value: number | undefined) => value ?? 0,
    },
    {
      title: '创建人',
      dataIndex: 'createdByName',
      width: 120,
      render: (value: string | null | undefined) => value || EMPTY_PLACEHOLDER,
    },
    dateTimeColumn('更新时间', 'updatedAt'),
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      fixed: 'right',
      render: (value: WorkflowFormStatus) => {
        return <Tag color={STATUS_COLORS[value]}>{WORKFLOW_FORM_STATUS_LABELS[value]}</Tag>;
      },
    },
    operationColumn,
  ];

  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={<KeywordInput placeholder="搜索表单名称/标识" {...bindKeyword('keyword')} />}
        filters={(
          <>
            <StatusSelect
              items={statusItems}
              {...bind('status', (value) => toStatus(value))}
            />
            <FilterSelect
              placeholder="全部分类"
              items={categoryOptions}
              {...bind('categoryId')}
              width={160}
            />
          </>
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        create={<CreateButton permission="workflow:form:create" onClick={() => navigate('/workflow/forms/designer')}>新建表单</CreateButton>}
        filterTitle="表单筛选"
      />

      <ConfigurableTable<WorkflowForm>
        columns={columns}
        {...tableProps}
      />
    </div>
  );
}
