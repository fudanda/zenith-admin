import { Col, Form, Row, Tag } from '@douyinfe/semi-ui';
import { inAppTemplateContract, type CreateInAppTemplateInput, type InAppMessageType, type InAppTemplate } from '@arcbase/shared/messaging';
import { usePermission } from '@/hooks/usePermission';
import { useDictItems } from '@/hooks/useDictItems';
import { useEditModal } from '@/hooks/useEditModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { ListSearchToolbar, useStatusToggle, useCrudOperationColumn } from '@/components/list-page';
import { createdAtColumn, renderEllipsis } from '../../../utils/table-columns';
import {
  useDeleteInAppTemplate,
  useInAppTemplateDetail,
  useInAppTemplateList,
  useSaveInAppTemplate,
} from '@/hooks/queries/in-app-templates';
import { IN_APP_MESSAGE_TYPE_OPTIONS_WITH_COLOR as TYPE_OPTIONS } from '../in-app-message-constants';
import { CreateButton } from '@/components/toolbar-controls';
import { FilterSelect } from '@/components/search-filters';
import { TemplateNameCodeRow, TemplateVariablesRemarkRows } from '../message-template-form';
import { useListPage } from '@/hooks/useListPage';
import { EditFormModal } from '@/components/EditFormModal';

export default function InAppTemplatesPage() {
  const { hasPermission: can } = usePermission();
  const { options: statusOptions } = useDictItems('common_status');
  const page = useListPage({
    contract: inAppTemplateContract,
    useList: useInAppTemplateList,
  });
  const { tableProps } = page;

  const saveMutation = useSaveInAppTemplate();
  const modal = useEditModal<InAppTemplate, Partial<CreateInAppTemplateInput>>({
    entityName: '站内信模板',
    save: saveMutation,
    useDetail: useInAppTemplateDetail,
    defaults: { status: 'enabled', type: 'info' },
    toValues: (r) => ({
      name: r.name,
      code: r.code,
      title: r.title,
      content: r.content,
      type: r.type,
      variables: r.variables ?? undefined,
      status: r.status,
      remark: r.remark ?? undefined,
    }),
    labelWidth: 120,
  });
  const toggleStatusMutation = useSaveInAppTemplate();
  const deleteMutation = useDeleteInAppTemplate();
  const status = useStatusToggle<InAppTemplate>({
    toggle: (record, enabled) => toggleStatusMutation.mutateAsync({ id: record.id, values: { status: enabled ? 'enabled' : 'disabled' } }),
    confirmDisable: (record) => ({ danger: true, title: `确认禁用模板「${record.name}」？`, okText: '确认禁用' }),
    disabled: !can('system:in-app-template:update'),
    messages: { disabled: '已禁用' },
  });

  const operationColumn = useCrudOperationColumn<InAppTemplate>({
    permission: 'system:in-app-template',
    edit: modal,
    remove: deleteMutation,
    title: '确定要删除该站内信模板吗？',
    width: 150,
  });

  const columns = [
    { title: '模板名称', dataIndex: 'name', width: 160 },
    { title: '模板编码', dataIndex: 'code', width: 180 },
    { title: '标题', dataIndex: 'title', render: renderEllipsis },
    {
      title: '类型', dataIndex: 'type', width: 90,
      render: (v: InAppMessageType) => {
        const it = TYPE_OPTIONS.find((t) => t.value === v);
        return <Tag color={it?.color ?? 'grey'} type="light">{it?.label ?? v}</Tag>;
      },
    },
    createdAtColumn,
    status.column(),
    operationColumn,
  ];

  return (
    <div className="page-container">
      <ListSearchToolbar
        page={page}
        filters={['keyword', 'type', 'status']}
        overrides={{
          type: (p) => (
            <FilterSelect
              placeholder="全部类型"
              items={TYPE_OPTIONS}
              {...p.bind('type')}
            />
          ),
        }}
        create={<CreateButton permission="system:in-app-template:create" onClick={modal.openCreate} />}
        filterTitle="站内信模板筛选"
      />

      <ConfigurableTable<InAppTemplate>
        columns={columns}
        {...tableProps}
      />

      <EditFormModal modal={modal} width={720}>
        <TemplateNameCodeRow isEdit={modal.isEdit} />
        <Row gutter={16}>
          <Col span={12}>
            <Form.Select field="type" label="类型" style={{ width: '100%' }} optionList={TYPE_OPTIONS}
              placeholder="请选择类型"
              rules={[{ required: true, message: '请选择类型' }]} />
          </Col>
          <Col span={12}>
            <Form.Select field="status" label="状态" style={{ width: '100%' }} placeholder="请选择状态"
              optionList={statusOptions} />
          </Col>
        </Row>
        <Row gutter={16}>
          <Col span={24}>
            <Form.Input field="title" label="标题" placeholder="请输入标题"
              rules={[{ required: true, message: '请输入标题' }]} />
          </Col>
        </Row>
        <Row gutter={16}>
          <Col span={24}>
            <Form.TextArea field="content" label="内容" rows={5} placeholder="请输入内容"
              rules={[{ required: true, message: '请输入内容' }]} />
          </Col>
        </Row>
        <TemplateVariablesRemarkRows />
      </EditFormModal>
    </div>
  );
}
