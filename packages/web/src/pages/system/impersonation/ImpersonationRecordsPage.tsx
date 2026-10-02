import { Tag, Toast } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { TagColor } from '@douyinfe/semi-ui/lib/es/tag';
import {
  IMPERSONATION_END_REASON_LABELS,
  IMPERSONATION_STATUS_LABELS,
  impersonationContract,
  type ImpersonationSession,
  type ImpersonationStatus,
} from '@arcbase/shared/identity';
import ConfigurableTable from '@/components/ConfigurableTable';
import { ListSearchToolbar } from '@/components/list-page';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { UserDisplayCell } from '@/components/UserDisplay';
import { useForceEndImpersonation, useImpersonationList } from '@/hooks/queries/impersonation';
import { useListPage } from '@/hooks/useListPage';
import { usePermission } from '@/hooks/usePermission';
import { confirmDanger } from '@/utils/confirm';
import { dateTimeColumn, EMPTY_PLACEHOLDER, renderEllipsis } from '@/utils/table-columns';

const STATUS_COLORS: Record<ImpersonationStatus, TagColor> = {
  active: 'orange',
  ended: 'grey',
};

export default function ImpersonationRecordsPage() {
  const { hasPermission } = usePermission();
  const page = useListPage({
    contract: impersonationContract,
    useList: useImpersonationList,
    table: { empty: '暂无模拟登录记录' },
  });
  const forceEndMutation = useForceEndImpersonation();

  const handleForceEnd = (record: ImpersonationSession) => {
    confirmDanger({
      title: '强制结束模拟会话',
      content: `确定要强制结束「${record.impersonatorName}」对「${record.targetUsername}」的模拟登录吗？该标签页会立即回到操作者身份。`,
      okText: '强制结束',
      onOk: async () => {
        await forceEndMutation.mutateAsync({ params: { id: record.id } });
        Toast.success('已强制结束该模拟会话');
      },
    });
  };

  const columns: ColumnProps<ImpersonationSession>[] = [
    { title: '操作人', dataIndex: 'impersonatorName', width: 160, render: (v: string, r) => <UserDisplayCell username={v} nickname={r.impersonatorNickname} /> },
    { title: '目标用户', dataIndex: 'targetUsername', width: 160, render: (v: string, r) => <UserDisplayCell username={v} nickname={r.targetNickname} /> },
    {
      title: '模式',
      dataIndex: 'readOnly',
      width: 90,
      render: (readOnly: boolean) => <Tag size="small" color={readOnly ? 'blue' : 'red'}>{readOnly ? '只读' : '可操作'}</Tag>,
    },
    { title: '原因', dataIndex: 'reason', minWidth: 220, render: renderEllipsis },
    { title: 'IP 地址', dataIndex: 'ip', width: 130, render: (v: string | null) => v ?? EMPTY_PLACEHOLDER },
    { title: '地点', dataIndex: 'location', width: 150, render: (v: string | null) => renderEllipsis(v ?? EMPTY_PLACEHOLDER) },
    dateTimeColumn('开始时间', 'startedAt'),
    dateTimeColumn('到期时间', 'expiresAt'),
    dateTimeColumn('结束时间', 'endedAt', { empty: EMPTY_PLACEHOLDER }),
    {
      title: '结束方式',
      dataIndex: 'endReason',
      width: 100,
      render: (v: ImpersonationSession['endReason']) => (v ? IMPERSONATION_END_REASON_LABELS[v] : EMPTY_PLACEHOLDER),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      fixed: 'right',
      render: (v: ImpersonationStatus) => <Tag size="small" color={STATUS_COLORS[v]}>{IMPERSONATION_STATUS_LABELS[v]}</Tag>,
    },
    createOperationColumn<ImpersonationSession>({
      width: 120,
      actions: (record) => [
        {
          key: 'force-end',
          label: '强制结束',
          danger: true,
          hidden: record.status !== 'active' || !hasPermission('system:impersonation:forceEnd'),
          onClick: () => handleForceEnd(record),
        },
      ],
    }),
  ];

  return (
    <div className="page-container">
      <ListSearchToolbar
        page={page}
        filters={['keyword', 'status', ['startTime', 'endTime']]}
        filterTitle="模拟登录记录筛选"
      />
      <ConfigurableTable<ImpersonationSession> columns={columns} {...page.tableProps} />
    </div>
  );
}
