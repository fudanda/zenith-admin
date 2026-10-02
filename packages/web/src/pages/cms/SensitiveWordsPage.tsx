import { Banner, Form, Tag } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { createdAtColumn, renderEnabledStatusTag } from '@/utils/table-columns';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
import { useCmsSensitiveWordList, useSaveCmsSensitiveWord, useDeleteCmsSensitiveWords } from '@/hooks/queries/cms';
import { cmsSensitiveWordContract, type CmsSensitiveWord } from '@arcbase/shared/cms';
import { CreateButton } from '@/components/toolbar-controls';
import { deleteAction, ListSearchToolbar } from '@/components/list-page';
import { FormStatusRadioGroup } from '@/components/FormStatusRadioGroup';
import { useListPage } from '@/hooks/useListPage';
import { EditFormModal } from '@/components/EditFormModal';

export default function SensitiveWordsPage() {
  const { hasPermission } = usePermission();
  const page = useListPage({
    contract: cmsSensitiveWordContract,
    useList: useCmsSensitiveWordList,
    table: { empty: '暂无敏感词' },
  });
  const { tableProps } = page;
  const saveMutation = useSaveCmsSensitiveWord();
  const modal = useEditModal<CmsSensitiveWord, Partial<CmsSensitiveWord>, Record<string, unknown>>({
    entityName: '敏感词',
    save: saveMutation,
    defaults: { status: 'enabled' },
    toValues: (record) => ({ word: record.word, replaceWith: record.replaceWith ?? '', status: record.status }),
    beforeSave: (values) => ({ ...values, replaceWith: values.replaceWith || null }),
  });
  const deleteMutation = useDeleteCmsSensitiveWords();
  const canManage = hasPermission('cms:sensitive:manage');

  const columns: ColumnProps<CmsSensitiveWord>[] = [
    { title: '敏感词', dataIndex: 'word', minWidth: 180 },
    {
      title: '处理方式',
      dataIndex: 'replaceWith',
      width: 200,
      render: (v: string | null) => (v
        ? <Tag size="small" color="orange">替换为「{v}」</Tag>
        : <Tag size="small" color="red">拦截提交</Tag>),
    },
    createdAtColumn,
    {
      title: '状态', dataIndex: 'status', width: 80, fixed: 'right',
      render: renderEnabledStatusTag,
    },
    createOperationColumn<CmsSensitiveWord>({
      width: 150,
      desktopInlineKeys: ['edit', 'delete'],
      actions: (record) => canManage ? [
        { key: 'edit', label: '编辑', onClick: () => modal.openEdit(record) },
        // eslint-disable-next-line no-restricted-syntax -- 按权限条件拼装的动作数组，保留 createOperationColumn
        deleteAction({
          title: '确定要删除该敏感词吗？',
          run: () => deleteMutation.mutateAsync([record.id]),
        }),
      ] : [],
    }),
  ];

  return (
    <div className="page-container">
      <Banner type="info" closeIcon={null} style={{ marginBottom: 12 }} description="敏感词库全局生效，作用于前台评论与自定义表单提交：拦截模式命中直接拒绝提交，替换模式命中替换为指定文本。" />
      <ListSearchToolbar
        page={page}
        filters={['keyword']}
        create={canManage ? <CreateButton onClick={modal.openCreate} /> : null}
      />

      <ConfigurableTable<CmsSensitiveWord>
        columns={columns}
        {...tableProps}
      />

      <EditFormModal modal={modal} width={480}>
        <Form.Input field="word" label="敏感词" rules={[{ required: true, message: '请输入敏感词' }]} />
        <Form.Input field="replaceWith" label="替换为" placeholder="留空 = 拦截模式（命中直接拒绝提交）" />
        <FormStatusRadioGroup />
      </EditFormModal>
    </div>
  );
}
