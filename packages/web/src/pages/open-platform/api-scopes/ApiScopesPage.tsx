import { Tag, Form, Typography, Row, Col } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { API_SCOPE_GROUPS, API_SCOPE_GROUP_LABELS, apiScopeContract } from '@arcbase/shared/open-platform';
import type { ApiScope, CreateApiScopeInput } from '@arcbase/shared/open-platform';
import { copyableNoColumn, createdAtColumn, renderEnabledStatusTag } from '@/utils/table-columns';
import ConfigurableTable from '@/components/ConfigurableTable';
import { confirmAndDelete, ListSearchToolbar, useRowSelection, useCrudOperationColumn } from '@/components/list-page';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
import {
  useApiScopeList,
  useDeleteApiScopes,
  useSaveApiScope,
} from '@/hooks/queries/open-platform';
import { useDictItems } from '@/hooks/useDictItems';
import { BatchDeleteButton, CreateButton } from '@/components/toolbar-controls';
import { FilterSelect } from '@/components/search-filters';
import { useListPage } from '@/hooks/useListPage';
import { EditFormModal } from '@/components/EditFormModal';

const { Text } = Typography;

const GROUP_OPTIONS = API_SCOPE_GROUPS.map((g) => ({ value: g, label: API_SCOPE_GROUP_LABELS[g] ?? g }));

export default function ApiScopesPage() {
  const { options: statusOptions } = useDictItems('common_status');
  const { hasPermission } = usePermission();
  const canManage = hasPermission('open:scope:manage');

  const { selectedRowKeys, clear: clearSelection, rowSelection } = useRowSelection();
  const page = useListPage({
    contract: apiScopeContract,
    useList: useApiScopeList,
    table: { empty: '暂无数据', rowSelection: canManage ? rowSelection : undefined },
  });
  const { tableProps } = page;

  const deleteMutation = useDeleteApiScopes();

  const modal = useEditModal<ApiScope, Partial<CreateApiScopeInput>>({
    save: useSaveApiScope(),
    defaults: { scopeGroup: 'general', status: 'enabled' },
    // 记录里的 null 描述在表单中视为未填
    toValues: (r) => ({
      code: r.code,
      name: r.name,
      scopeGroup: r.scopeGroup,
      description: r.description ?? undefined,
      status: r.status,
    }),
    labelWidth: 110,
  });

  function handleBatchDelete() {
    confirmAndDelete({
      title: `确定删除选中的 ${selectedRowKeys.length} 个 Scope？`,
      content: '删除后不可恢复',
      run: () => deleteMutation.mutateAsync(selectedRowKeys),
      successMessage: '批量删除成功',
      onDeleted: clearSelection,
    });
  }

  const operationColumn = useCrudOperationColumn<ApiScope>({
    edit: modal,
    remove: deleteMutation,
    allow: { edit: canManage, remove: canManage },
    title: '确定要删除此 Scope 吗？',
    content: '删除后不可恢复',
    width: 150,
  });

  const columns: ColumnProps<ApiScope>[] = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    copyableNoColumn('Scope 编码', 'code', { width: 200 }),
    { title: '名称', dataIndex: 'name', width: 160, render: (v: string) => <Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 150 }}>{v}</Text> },
    {
      title: '分组',
      dataIndex: 'scopeGroup',
      width: 100,
      render: (v: string) => <Tag size="small" color="blue">{API_SCOPE_GROUP_LABELS[v] ?? v}</Tag>,
    },
    { title: '描述', dataIndex: 'description', minWidth: 240, render: (v: string | null) => v ? <Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 230 }}>{v}</Text> : <Text type="tertiary">—</Text> },
    {
      title: '被引用',
      align: 'right',
      dataIndex: 'usedByAppCount',
      width: 100,
      render: (v: number) => (
        v > 0
          ? <Tag size="small" color="orange">{v} 个应用</Tag>
          : <Text type="tertiary">未被引用</Text>
      ),
    },
    createdAtColumn,
    {
      title: '状态',
      dataIndex: 'status',
      width: 80,
      fixed: 'right' as const,
      render: renderEnabledStatusTag,
    },
    operationColumn,
  ];

  return (
    <div className="page-container">
      <ListSearchToolbar
        page={page}
        filters={['keyword', 'scopeGroup', 'status']}
        overrides={{
          scopeGroup: (p) => (
            <FilterSelect
              placeholder="全部分组"
              items={GROUP_OPTIONS}
              {...p.bind('scopeGroup')}
            />
          ),
        }}
        create={canManage && <CreateButton onClick={modal.openCreate} />}
        actions={canManage && selectedRowKeys.length > 0 && <BatchDeleteButton label="批量删除" count={selectedRowKeys.length} onClick={handleBatchDelete} />}
        actionTitle="Scope 操作"
      />

      <ConfigurableTable<ApiScope>
        columns={columns}
        {...tableProps}
      />

      <EditFormModal modal={modal} title={modal.isEdit ? '编辑 API Scope' : '新增 API Scope'} width={520}>
        <Form.Input
          field="code"
          label="Scope 编码"
          placeholder="如 user:read"
          disabled={modal.isEdit}
          extraText={modal.isEdit ? '编码创建后不可修改' : '小写字母开头，可含 : . _ -'}
          rules={[{ required: true, message: 'Scope 编码不能为空' }]}
        />
        <Form.Input field="name" label="名称" placeholder="如 读取用户信息" rules={[{ required: true, message: '名称不能为空' }]} />
        <Row gutter={16}>
          <Col span={12}>
            <Form.Select field="scopeGroup" label="分组" style={{ width: '100%' }} optionList={GROUP_OPTIONS} filter allowCreate rules={[{ required: true, message: '请选择分组' }]} />
          </Col>
          <Col span={12}>
            <Form.Select field="status" label="状态" style={{ width: '100%' }} optionList={statusOptions} rules={[{ required: true, message: '请选择状态' }]} />
          </Col>
        </Row>
        <Form.TextArea field="description" label="描述" placeholder="该 scope 授予的权限说明（可选）" rows={2} />
      </EditFormModal>
    </div>
  );
}
