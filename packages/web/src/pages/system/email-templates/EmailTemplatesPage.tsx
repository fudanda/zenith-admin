import { Col, Form, Row } from '@douyinfe/semi-ui';
import { emailTemplateContract, type CreateEmailTemplateInput, type EmailTemplate } from '@arcbase/shared/messaging';
import { usePermission } from '@/hooks/usePermission';
import { useDictItems } from '@/hooks/useDictItems';
import { useEditModal } from '@/hooks/useEditModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { ListSearchToolbar, useStatusToggle, useCrudOperationColumn } from '@/components/list-page';
import { createdAtColumn, renderEllipsis } from '../../../utils/table-columns';
import {
  useDeleteEmailTemplate,
  useEmailTemplateDetail,
  useEmailTemplateList,
  useSaveEmailTemplate,
} from '@/hooks/queries/email-templates';
import { CreateButton } from '@/components/toolbar-controls';
import { TemplateNameCodeRow, TemplateVariablesRemarkRows } from '../message-template-form';
import { useListPage } from '@/hooks/useListPage';
import { EditFormModal } from '@/components/EditFormModal';

export default function EmailTemplatesPage() {
  const { hasPermission: can } = usePermission();
  const { options: statusOptions } = useDictItems('common_status');
  const page = useListPage({
    contract: emailTemplateContract,
    useList: useEmailTemplateList,
  });
  const { tableProps } = page;

  const saveMutation = useSaveEmailTemplate();
  const modal = useEditModal<EmailTemplate, Partial<CreateEmailTemplateInput>>({
    entityName: '邮件模板',
    save: saveMutation,
    useDetail: useEmailTemplateDetail,
    defaults: { status: 'enabled' },
    toValues: (r) => ({
      name: r.name,
      code: r.code,
      subject: r.subject,
      content: r.content,
      variables: r.variables ?? undefined,
      status: r.status,
      remark: r.remark ?? undefined,
    }),
    labelWidth: 120,
  });

  const toggleStatusMutation = useSaveEmailTemplate();
  const deleteMutation = useDeleteEmailTemplate();
  const status = useStatusToggle<EmailTemplate>({
    toggle: (record, enabled) => toggleStatusMutation.mutateAsync({ id: record.id, values: { status: enabled ? 'enabled' : 'disabled' } }),
    confirmDisable: (record) => ({ danger: true, title: `确认禁用模板「${record.name}」？`, okText: '确认禁用' }),
    disabled: !can('system:email-template:update'),
    messages: { disabled: '已禁用' },
  });

  const operationColumn = useCrudOperationColumn<EmailTemplate>({
    permission: 'system:email-template',
    edit: modal,
    remove: deleteMutation,
    title: '确定要删除该邮件模板吗？',
    width: 150,
  });

  const columns = [
    { title: '模板名称', dataIndex: 'name', width: 160 },
    { title: '模板编码', dataIndex: 'code', width: 180 },
    { title: '邮件主题', dataIndex: 'subject', render: renderEllipsis },
    { title: '变量', dataIndex: 'variables', width: 200, render: renderEllipsis },
    { title: '备注', dataIndex: 'remark', render: renderEllipsis },
    createdAtColumn,
    status.column(),
    operationColumn,
  ];

  return (
    <div className="page-container">
      <ListSearchToolbar
        page={page}
        filters={['keyword', 'status']}
        create={<CreateButton permission="system:email-template:create" onClick={modal.openCreate} />}
        filterTitle="邮件模板筛选"
      />

      <ConfigurableTable<EmailTemplate>
        columns={columns}
        {...tableProps}
      />

      <EditFormModal modal={modal} width={720}>
        <TemplateNameCodeRow isEdit={modal.isEdit} codePlaceholder="如：welcome_email" />
        <Row gutter={16}>
          <Col span={12}>
            <Form.Input field="subject" label="邮件主题" placeholder="请输入邮件主题"
              rules={[{ required: true, message: '请输入邮件主题' }]} />
          </Col>
          <Col span={12}>
            <Form.Select field="status" label="状态" style={{ width: '100%' }} placeholder="请选择状态"
              optionList={statusOptions} />
          </Col>
        </Row>
        <Row gutter={16}>
          <Col span={24}>
            <Form.TextArea field="content" label="邮件内容" rows={6} placeholder="请输入邮件内容"
              rules={[{ required: true, message: '请输入邮件内容' }]} />
          </Col>
        </Row>
        <TemplateVariablesRemarkRows />
      </EditFormModal>
    </div>
  );
}
