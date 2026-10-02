import { Button, Form } from '@douyinfe/semi-ui';
import { Plus } from 'lucide-react';
import type { EmailSendLog, SendEmailInput, SendSource, SendStatus } from '@arcbase/shared/messaging';
import { usePermission } from '@/hooks/usePermission';
import ExportButton from '@/components/ExportButton';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { deleteAction, ListSearchToolbar } from '@/components/list-page';
import { dateTimeColumn, EMPTY_PLACEHOLDER, renderEllipsis } from '../../../utils/table-columns';
import { useEmailTemplateList } from '@/hooks/queries/email-templates';
import { useEditModal } from '@/hooks/useEditModal';
import {
  emailSendLogKeys,
  useDeleteEmailSendLog,
  useEmailSendLogList,
  useTestEmailSendLog,
} from '@/hooks/queries/email-send-logs';
import { parseTemplateVariables } from '../send-log-constants';
import { KeywordInput } from '@/components/search-filters';
import { SendLogStatusSourceFilters } from '../send-log-ui';
import { sendLogErrorColumn, sendLogOperatorColumn, sendLogSourceColumn, sendLogStatusColumn } from '../send-log-columns';
import { useListPage } from '@/hooks/useListPage';
import { EditFormModal } from '@/components/EditFormModal';

/** 测试发送表单值：变量以 JSON 文本输入 */
interface TestEmailFormValues {
  templateId?: number;
  toEmail: string;
  subject?: string;
  content?: string;
  variables?: string;
}

export default function EmailSendLogsPage() {
  const { hasPermission: can } = usePermission();

  interface SearchParams { keyword: string; toEmail: string; filterStatus?: SendStatus; filterSource?: SendSource }
  const defaultSearchParams: SearchParams = { keyword: '', toEmail: '', filterStatus: undefined, filterSource: undefined };
  const {
    bind,
    bindKeyword,
    handleSearch,
    handleReset,
    tableProps,
    filterQuery,
  } = useListPage({
    defaults: defaultSearchParams,
    listKey: emailSendLogKeys.lists,
    useList: useEmailSendLogList,
    toQuery: (s) => ({ keyword: s.keyword, toEmail: s.toEmail, status: s.filterStatus, source: s.filterSource }),
  });

  const testMutation = useTestEmailSendLog();
  const testModal = useEditModal<{ id: number }, TestEmailFormValues, SendEmailInput>({
    save: {
      isPending: testMutation.isPending,
      mutateAsync: async ({ values }) => {
        await testMutation.mutateAsync({ body: values });
        return { id: 0 };
      },
    },
    defaults: {},
    beforeSave: (values) => ({ ...values, variables: parseTemplateVariables(values.variables) }),
    successMessage: () => '测试邮件已发送',
  });
  const templatesQuery = useEmailTemplateList({ page: 1, pageSize: 100, status: 'enabled' }, testModal.visible);
  const templates = templatesQuery.data?.list ?? [];
  const deleteMutation = useDeleteEmailSendLog();


  const columns = [
    { title: '收件人', dataIndex: 'toEmail', width: 200 },
    { title: '邮件主题', dataIndex: 'subject', render: renderEllipsis },
    { title: '模板', dataIndex: 'templateName', width: 140, render: (v: string | null) => v || EMPTY_PLACEHOLDER },
    sendLogSourceColumn<EmailSendLog>(),
    sendLogOperatorColumn<EmailSendLog>(),
    { title: 'IP', dataIndex: 'ip', width: 130, render: (v: string | null) => v || EMPTY_PLACEHOLDER },
    dateTimeColumn('发送时间', 'sentAt'),
    sendLogErrorColumn<EmailSendLog>(),
    sendLogStatusColumn<EmailSendLog>(),
    createOperationColumn<EmailSendLog>({
      width: 100,
      actions: (record) => [
        deleteAction({
          hidden: !can('system:email-send-log:delete'),
          title: '确定要删除该记录吗？',
          run: () => deleteMutation.mutateAsync({ params: { id: record.id } }),
        }),
      ],
    }),
  ];

  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={<KeywordInput placeholder="主题/内容关键词" {...bindKeyword('keyword')} width={200} />}
        filters={(
          <>
            <KeywordInput placeholder="收件人邮箱" {...bindKeyword('toEmail')} width={200} />
            <SendLogStatusSourceFilters status={bind('filterStatus')} source={bind('filterSource')} />
          </>
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        create={can('system:email-config:update') && (
          <Button type="primary" icon={<Plus size={14} />} onClick={testModal.openCreate}>测试发送</Button>
        )}
        actions={(
          <ExportButton entity="system.email-send-logs" query={filterQuery} permission="system:email-send-log:export" />
        )}
        filterTitle="邮件发送日志筛选"
        actionTitle="邮件日志操作"
      />

      <ConfigurableTable<EmailSendLog>
        columns={columns}
        {...tableProps}
      />

      <EditFormModal modal={testModal} title="测试发送邮件" width={560}>
        <Form.Select field="templateId" label="模板" style={{ width: '100%' }} showClear
          optionList={templates.map((t) => ({ label: `${t.name} (${t.code})`, value: t.id }))} />
        <Form.Input field="toEmail" label="收件人" rules={[{ required: true, message: '请输入收件人邮箱' }]} />
        <Form.Input field="subject" label="邮件主题" rules={[{ required: true, message: '请输入邮件主题' }]} />
        <Form.TextArea field="content" label="邮件内容" rows={5} rules={[{ required: true, message: '请输入邮件内容' }]} />
        <Form.Input field="variables" label="变量" placeholder='如：{"username":"张三"}' />
      </EditFormModal>
    </div>
  );
}
