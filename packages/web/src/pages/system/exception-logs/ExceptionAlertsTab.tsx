import { useMemo, useState } from 'react';
import { Button, Toast } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Bell } from 'lucide-react';
import type { ErrorAlertLog, ErrorAlertRule } from '@arcbase/shared/analytics';
import { SERVER_ERROR_TYPE_OPTIONS } from '@arcbase/shared/analytics';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { ErrorAlertRuleModal, errorAlertLogColumns, errorAlertRuleColumns, type ErrorAlertRuleValues } from '@/components/error-tracking';
import { SearchToolbar } from '@/components/SearchToolbar';
import { listTableProps } from '@/components/list-page';
import {
  useDeleteExceptionAlert,
  useExceptionAlertLogs,
  useExceptionAlerts,
  useSaveExceptionAlert,
  useTestExceptionAlert,
} from '@/hooks/queries/exception-logs';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';

/** 服务端异常告警规则：与前端错误页共用规则表 / 编辑弹窗，只是可选类型限服务端类型 */
export function ExceptionAlertsTab({ active }: Readonly<{ active: boolean }>) {
  const { hasPermission } = usePermission();
  const canManage = hasPermission('system:exception-log:manage');
  const { page, pageSize, buildPagination } = usePagination({ pageSize: 20 });
  const alertsQuery = useExceptionAlerts({ page, pageSize }, active);
  const saveMutation = useSaveExceptionAlert();
  const deleteMutation = useDeleteExceptionAlert();
  const testMutation = useTestExceptionAlert();
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<ErrorAlertRule | null>(null);

  const openModal = (rule?: ErrorAlertRule) => {
    setEditing(rule ?? null);
    setModalVisible(true);
  };

  const submit = async (values: ErrorAlertRuleValues) => {
    await saveMutation.mutateAsync({ id: editing?.id, values });
    Toast.success(editing ? '更新成功' : '创建成功');
    setModalVisible(false);
  };

  const columns = useMemo<ColumnProps<ErrorAlertRule>[]>(() => errorAlertRuleColumns({
    onEdit: (rule) => openModal(rule),
    onTest: async (rule) => {
      await testMutation.mutateAsync({ params: { id: rule.id } });
      Toast.success('测试消息已发送，请检查通知渠道');
    },
    onToggle: async (rule, enabled) => {
      await saveMutation.mutateAsync({ id: rule.id, values: { enabled } });
      Toast.success(enabled ? '已启用' : '已停用');
    },
    onDelete: (rule) => deleteMutation.mutateAsync({ params: { id: rule.id } }),
  }), [deleteMutation, saveMutation, testMutation]);

  return (
    <>
      <SearchToolbar
        primary={canManage ? <Button type="primary" icon={<Bell size={14} />} onClick={() => openModal()}>新增规则</Button> : null}
      />
      <ConfigurableTable<ErrorAlertRule>
        columns={columns}
        {...listTableProps(alertsQuery, { pagination: buildPagination })}
        empty="尚未配置服务端异常告警规则"
      />
      <ErrorAlertRuleModal
        visible={modalVisible}
        rule={editing}
        typeOptions={SERVER_ERROR_TYPE_OPTIONS}
        saving={saveMutation.isPending}
        onCancel={() => setModalVisible(false)}
        onSubmit={submit}
      />
    </>
  );
}

export function ExceptionAlertLogsTab({ active }: Readonly<{ active: boolean }>) {
  const { page, pageSize, buildPagination } = usePagination({ pageSize: 20 });
  const logsQuery = useExceptionAlertLogs({ page, pageSize }, active);
  const columns = useMemo<ColumnProps<ErrorAlertLog>[]>(() => errorAlertLogColumns(), []);
  return (
    <ConfigurableTable<ErrorAlertLog>
      columns={columns}
      {...listTableProps(logsQuery, { pagination: buildPagination })}
      empty="暂无告警触发记录"
    />
  );
}
