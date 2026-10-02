import { Toast } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { wikiDocContract, type WikiDoc } from '@arcbase/shared/wiki';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { deleteAction, ListSearchToolbar } from '@/components/list-page';
import { dateTimeColumn, EMPTY_PLACEHOLDER, renderEllipsis } from '@/utils/table-columns';
import { usePermission } from '@/hooks/usePermission';
import { usePurgeWikiDoc, useRestoreWikiDoc, useWikiDocRecycleList } from '@/hooks/queries/wiki-docs';
import { useListPage } from '@/hooks/useListPage';

export default function WikiRecyclePage() {
  const { hasPermission } = usePermission();

  const page = useListPage({
    op: wikiDocContract.recycle,
    useList: useWikiDocRecycleList,
  });
  const { tableProps } = page;

  const restoreMutation = useRestoreWikiDoc();
  const purgeMutation = usePurgeWikiDoc();

  const columns: ColumnProps<WikiDoc>[] = [
    { title: '标题', dataIndex: 'title', minWidth: 240, render: renderEllipsis },
    { title: '所属空间', dataIndex: 'spaceName', width: 140, render: renderEllipsis },
    { title: '作者', dataIndex: 'authorName', width: 120, render: (v: string | null) => v ?? EMPTY_PLACEHOLDER },
    dateTimeColumn('删除时间', 'deletedAt'),
    createOperationColumn<WikiDoc>({
      width: 180,
      desktopInlineKeys: ['restore', 'purge'],
      actions: (record) => [
        ...(hasPermission('wiki:recycle:restore') ? [{
          key: 'restore', label: '还原',
          onClick: () => restoreMutation.mutate({ params: { id: record.id } }, { onSuccess: () => Toast.success('已还原') }),
        }] : []),
        deleteAction({
          key: 'purge',
          label: '彻底删除',
          hidden: !hasPermission('wiki:recycle:purge'),
          title: `彻底删除「${record.title}」？`,
          content: '彻底删除后文档及其版本、评论、收藏将全部清除，不可恢复！',
          run: () => purgeMutation.mutateAsync({ params: { id: record.id } }),
          successMessage: '已彻底删除',
        }),
      ],
    }),
  ];

  return (
    <div className="page-container">
      <ListSearchToolbar
        page={page}
        filters={['keyword']}
      />

      <ConfigurableTable<WikiDoc>
        columns={columns}
        empty="回收站是空的"
        {...tableProps}
      />
    </div>
  );
}
